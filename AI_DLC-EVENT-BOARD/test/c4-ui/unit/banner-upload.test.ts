import { describe, expect, it } from "vitest";
import { ApiClient } from "../../../ui/src/api/client.js";
import {
  MAX_BANNER_BYTES,
  uploadBanner,
  validateBannerFile,
} from "../../../ui/src/banner/upload.js";
import { COPY } from "../../../ui/src/copy.js";
import { FakeApi } from "./support/fake-api.js";

const EVENT_ID = "seed-event-community-market";

function file(size: number, type = "image/png"): File {
  return new File([new Uint8Array(size)], "banner.png", { type });
}

function setup(): { api: FakeApi; client: ApiClient } {
  const api = new FakeApi();
  const client = new ApiClient({
    getIdToken: async () => "synthetic-id-token",
    onUnauthorized: () => undefined,
    fetchImpl: api.fetch,
  });
  return { api, client };
}

describe("banner upload (D14)", () => {
  it("accepts exactly 5,242,880 bytes and rejects 5,242,881 before any request", async () => {
    expect(validateBannerFile(file(MAX_BANNER_BYTES))).toBeNull();
    const { api, client } = setup();
    const result = await uploadBanner(client, EVENT_ID, file(MAX_BANNER_BYTES + 1), api.fetch);
    expect(result).toEqual({ ok: false, message: COPY.bannerRule });
    expect(api.requests).toHaveLength(0);
  });

  it("rejects an empty file", () => {
    expect(validateBannerFile(file(0))).toBe(COPY.bannerRule);
  });

  it("rejects a GIF", async () => {
    const { api, client } = setup();
    const result = await uploadBanner(client, EVENT_ID, file(10, "image/gif"), api.fetch);
    expect(result).toEqual({ ok: false, message: COPY.bannerRule });
    expect(api.requests).toHaveLength(0);
  });

  it("appends every presigned field in order and the file last", async () => {
    const { api, client } = setup();
    await uploadBanner(client, EVENT_ID, file(100), api.fetch);
    const presign = api.requestsTo("POST", `/api/events/${EVENT_ID}/banner-upload`)[0];
    expect(presign.body).toEqual({ contentType: "image/png" });
    const upload = api.requestsTo("POST", "/")[0];
    const form = upload.body as FormData;
    expect([...form.keys()]).toEqual(["key", "Content-Type", "Policy", "X-Amz-Signature", "file"]);
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("sends no Content-Type or Authorization header to S3", async () => {
    const { api, client } = setup();
    await uploadBanner(client, EVENT_ID, file(100), api.fetch);
    const upload = api.requestsTo("POST", "/")[0];
    expect(upload.url.origin).toBe("https://upload.test");
    expect(upload.headers.get("content-type")).toBeNull();
    expect(upload.headers.get("authorization")).toBeNull();
  });

  it("maps 204 to uploaded with the CloudFront banner path", async () => {
    const { api, client } = setup();
    const result = await uploadBanner(client, EVENT_ID, file(100), api.fetch);
    expect(result).toEqual({
      ok: true,
      bannerReference: `banners/${EVENT_ID}/upload-1.png`,
      previewUrl: `/banners/${EVENT_ID}/upload-1.png`,
    });
  });

  it("maps an S3 400 EntityTooLarge XML body to the 5 MB message", async () => {
    const { api, client } = setup();
    api.on("POST", /^\/$/, () => ({
      status: 400,
      text: "<Error><Code>EntityTooLarge</Code></Error>",
      contentType: "application/xml",
    }));
    const result = await uploadBanner(client, EVENT_ID, file(100), api.fetch);
    expect(result).toEqual({ ok: false, message: COPY.bannerRule });
  });

  it("maps a network failure to the retry message and a presign denial to its copy", async () => {
    const { api, client } = setup();
    api.on("POST", /^\/$/, () => "network-error");
    await expect(uploadBanner(client, EVENT_ID, file(100), api.fetch)).resolves.toEqual({
      ok: false,
      message: COPY.bannerNetworkError,
    });
    api.on("POST", /banner-upload$/, () => ({
      status: 403,
      body: { code: "FORBIDDEN", message: "x", field: null },
    }));
    await expect(uploadBanner(client, EVENT_ID, file(100), api.fetch)).resolves.toEqual({
      ok: false,
      message: COPY.permissionDenied,
    });
  });
});
