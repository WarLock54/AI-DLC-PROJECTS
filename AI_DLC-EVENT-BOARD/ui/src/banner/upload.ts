// D14: banner upload. Pre-checks run before any request; the presigned POST is
// sent straight to S3 as multipart FormData with the file as the final field.
// No Content-Type header (the browser adds the boundary) and no Authorization
// header are sent to S3. S3 enforces the policy; these checks only save a trip.
import type { ApiClient } from "../api/client.js";
import { COPY, messageForError } from "../copy.js";

export const MAX_BANNER_BYTES = 5_242_880;
export const ALLOWED_BANNER_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

export type BannerUploadResult =
  | { ok: true; bannerReference: string; previewUrl: string }
  | { ok: false; message: string };

/** Returns a user message when the file breaks the type/size rule, else null. */
export function validateBannerFile(file: File): string | null {
  if (!ALLOWED_BANNER_TYPES.includes(file.type) || file.size < 1 || file.size > MAX_BANNER_BYTES) {
    return COPY.bannerRule;
  }
  return null;
}

export function buildUploadForm(fields: Record<string, string>, file: File): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append("file", file);
  return form;
}

export async function uploadBanner(
  api: ApiClient,
  eventId: string,
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<BannerUploadResult> {
  const invalid = validateBannerFile(file);
  if (invalid) {
    return { ok: false, message: invalid };
  }
  let presigned;
  try {
    presigned = await api.createBannerUpload(eventId, file.type);
  } catch (error) {
    return { ok: false, message: messageForError(error) };
  }
  let response: Response;
  try {
    response = await fetchImpl(presigned.url, {
      method: "POST",
      body: buildUploadForm(presigned.fields, file),
    });
  } catch {
    return { ok: false, message: COPY.bannerNetworkError };
  }
  if (response.status === 204 || response.status === 201) {
    return {
      ok: true,
      bannerReference: presigned.bannerReference,
      previewUrl: `/${presigned.bannerReference}`,
    };
  }
  // Any S3 rejection (EntityTooLarge, policy condition failure, ...) maps to the
  // same 5 MB / allowed-types rule.
  return { ok: false, message: COPY.bannerRule };
}
