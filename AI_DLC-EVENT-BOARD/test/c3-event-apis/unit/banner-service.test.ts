import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { describe, expect, it } from "vitest";
import {
  BANNER_MAX_BYTES,
  type BannerPresigner,
} from "../../../src/event-api/banner/banner-service.js";
import { eventItem, fakeWithSeed, SEED_EVENT_ID } from "../support/fixtures.js";
import {
  adminClaims,
  buildServices,
  captureApiError,
  organizerClaims,
  otherOrganizerClaims,
  residentClaims,
} from "../support/services.js";

function setup(presign?: BannerPresigner) {
  const fake = fakeWithSeed();
  return { fake, ...buildServices(fake, { presign }) };
}

describe("BannerService presigned POST policy (C-04, US2.3)", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("signs %s uploads limited to 1-5242880 bytes under banners/", async (type, extension) => {
    const { banner, presignCalls } = setup();
    const upload = await banner.createUpload(organizerClaims, SEED_EVENT_ID, { contentType: type });
    expect(presignCalls[0]).toEqual({
      Bucket: "team32-ceb-banner-test",
      Key: `banners/${SEED_EVENT_ID}/banner-0001.${extension}`,
      Conditions: [
        ["content-length-range", 1, 5242880],
        ["eq", "$Content-Type", type],
      ],
      Fields: { "Content-Type": type },
      Expires: 300,
    });
    expect(upload.bannerReference).toBe(`banners/${SEED_EVENT_ID}/banner-0001.${extension}`);
    expect(upload.fields["Content-Type"]).toBe(type);
    expect(BANNER_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("rejects disallowed content types with 400 VALIDATION_ERROR before signing", async () => {
    const { banner, presignCalls } = setup();
    for (const contentType of ["image/gif", "application/pdf", "constructor", 5]) {
      expect(
        await captureApiError(banner.createUpload(organizerClaims, SEED_EVENT_ID, { contentType })),
      ).toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400, field: "contentType" });
    }
    expect(presignCalls).toHaveLength(0);
  });

  it("forbids non-owners and residents with 403", async () => {
    const { banner, presignCalls } = setup();
    for (const claims of [otherOrganizerClaims, residentClaims]) {
      expect(
        await captureApiError(
          banner.createUpload(claims, SEED_EVENT_ID, { contentType: "image/png" }),
        ),
      ).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    }
    expect(presignCalls).toHaveLength(0);
  });

  it("stores the banner reference on Event META when the URL is issued; admins may upload", async () => {
    const { fake, banner, discovery } = setup();
    const upload = await banner.createUpload(adminClaims, SEED_EVENT_ID, {
      contentType: "image/webp",
    });
    expect(fake.get(`EVENT#${SEED_EVENT_ID}`, "META")?.bannerReference).toBe(
      upload.bannerReference,
    );
    await expect(discovery.getEvent(SEED_EVENT_ID)).resolves.toMatchObject({
      bannerReference: upload.bannerReference,
    });
  });

  it("returns 404 for unknown or deleted events", async () => {
    const { fake, banner } = setup();
    fake.seed([eventItem({ eventId: "gone", lifecycleStatus: "deleted" })]);
    for (const eventId of ["gone", "unknown", "bad#id"]) {
      expect(
        await captureApiError(
          banner.createUpload(adminClaims, eventId, { contentType: "image/png" }),
        ),
      ).toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    }
  });

  it("produces a real S3 POST policy that encodes the same conditions (no network)", async () => {
    const s3 = new S3Client({
      region: "us-east-1",
      // Static, obviously fake test credentials: signing is local and offline.
      credentials: { accessKeyId: "TESTACCESSKEYID", secretAccessKey: "test-secret-not-real" },
    });
    const { banner } = setup((request) => createPresignedPost(s3, request));
    const upload = await banner.createUpload(organizerClaims, SEED_EVENT_ID, {
      contentType: "image/png",
    });
    expect(upload.url).toContain("team32-ceb-banner-test");
    const policy = JSON.parse(Buffer.from(upload.fields.Policy, "base64").toString("utf8")) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ["content-length-range", 1, 5242880],
        ["eq", "$Content-Type", "image/png"],
        { bucket: "team32-ceb-banner-test" },
        { key: upload.bannerReference },
      ]),
    );
    expect(upload.fields.key).toBe(upload.bannerReference);
    expect(upload.fields["Content-Type"]).toBe("image/png");
    expect(upload.fields).not.toHaveProperty("AWSSecretAccessKey");
    expect(JSON.stringify(upload)).not.toContain("test-secret-not-real");
  });
});
