import {
  requireAuthenticated,
  requireGroup,
  requireOwnerOrAdmin,
  type Claims,
} from "../access/policy.js";
import type { EventRepository } from "../events/event-repository.js";
import { notFound, validationError } from "../http/errors.js";
import { requireEventId, requireObject } from "../http/fields.js";

// C-04 banner upload policy (D12). S3 enforces the signed conditions; the
// browser never receives write credentials.
export const BANNER_MAX_BYTES = 5_242_880;
export const BANNER_URL_EXPIRY_SECONDS = 300;
export const BANNER_KEY_PREFIX = "banners/";

export const BANNER_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type BannerContentType = keyof typeof BANNER_CONTENT_TYPES;

export type PresignCondition = ["eq", string, string] | ["content-length-range", number, number];

export interface PresignRequest {
  Bucket: string;
  Key: string;
  Conditions: PresignCondition[];
  Fields: Record<string, string>;
  Expires: number;
}

export interface PresignedPostResult {
  url: string;
  fields: Record<string, string>;
}

export type BannerPresigner = (request: PresignRequest) => Promise<PresignedPostResult>;

export interface BannerUpload extends PresignedPostResult {
  bannerReference: string;
}

export interface BannerServiceDependencies {
  events: Pick<EventRepository, "get" | "setBannerReference">;
  presign: BannerPresigner;
  bucketName: string;
  clock: () => Date;
  newId: () => string;
}

export class BannerService {
  constructor(private readonly deps: BannerServiceDependencies) {}

  async createUpload(
    claims: Claims,
    eventId: string | undefined,
    body: unknown,
  ): Promise<BannerUpload> {
    const principal = requireAuthenticated(claims);
    requireGroup(principal, ["organizer", "admin"]);
    const contentType = parseContentType(body);
    const id = requireEventId(eventId);
    const event = await this.deps.events.get(id);
    if (!event || event.lifecycleStatus !== "active") {
      throw notFound("Event not found.", "id");
    }
    requireOwnerOrAdmin(principal, event.organizerSubject);
    const key = `${BANNER_KEY_PREFIX}${id}/${this.deps.newId()}.${BANNER_CONTENT_TYPES[contentType]}`;
    const presigned = await this.deps.presign({
      Bucket: this.deps.bucketName,
      Key: key,
      Conditions: [
        ["content-length-range", 1, BANNER_MAX_BYTES],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: BANNER_URL_EXPIRY_SECONDS,
    });
    // C-02 EventWrite has no banner field, so the reference is stored when the
    // upload URL is issued (D12). An abandoned upload leaves a dangling key.
    await this.deps.events.setBannerReference(id, key, this.deps.clock().toISOString());
    return { url: presigned.url, fields: presigned.fields, bannerReference: key };
  }
}

function parseContentType(body: unknown): BannerContentType {
  const source = requireObject(body, ["contentType"]);
  const contentType = source.contentType;
  if (typeof contentType !== "string" || !Object.hasOwn(BANNER_CONTENT_TYPES, contentType)) {
    throw validationError(
      "contentType",
      "contentType must be one of image/jpeg, image/png, or image/webp (maximum 5 MB).",
    );
  }
  return contentType as BannerContentType;
}
