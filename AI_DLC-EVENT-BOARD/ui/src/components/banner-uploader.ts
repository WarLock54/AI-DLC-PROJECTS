// BannerUploader (D14): states empty, selected-valid, selected-invalid,
// uploading, uploaded, upload-error. Only enabled for an existing event. An
// upload failure never touches the event form values.
import type { ApiClient } from "../api/client.js";
import { uploadBanner, validateBannerFile } from "../banner/upload.js";
import { COPY } from "../copy.js";
import { el } from "../dom.js";

export type UploaderState =
  | "disabled"
  | "empty"
  | "selected-valid"
  | "selected-invalid"
  | "uploading"
  | "uploaded"
  | "upload-error";

export interface BannerUploaderOptions {
  eventId: string | null;
  api: ApiClient;
  fetchImpl: typeof fetch;
  announce(message: string): void;
  onUploaded?(bannerReference: string): void;
}

export function createBannerUploader(options: BannerUploaderOptions): HTMLElement {
  const hint = el("p", {
    text: "JPEG, PNG, or WebP image; maximum 5 MB.",
    testid: "banner-hint",
    attrs: { id: "banner-hint" },
  });
  const input = el("input", {
    testid: "banner-file",
    attrs: {
      id: "banner-file",
      type: "file",
      accept: "image/jpeg,image/png,image/webp",
      "aria-describedby": "banner-hint banner-status",
    },
  });
  const upload = el("button", {
    text: "Upload banner",
    testid: "banner-upload",
    className: "secondary",
    attrs: { type: "button" },
  });
  const status = el("p", {
    testid: "banner-status",
    attrs: { id: "banner-status", role: "status" },
  });
  const preview = el("img", { testid: "banner-preview", className: "banner", attrs: { alt: "" } });
  preview.hidden = true;
  const container = el("div", { testid: "banner-uploader", className: "field" }, [
    el("label", { text: "Banner image (optional)", attrs: { for: "banner-file" } }),
    hint,
    input,
    upload,
    status,
    preview,
  ]);

  const setState = (state: UploaderState, message = ""): void => {
    container.setAttribute("data-state", state);
    status.textContent = message;
    status.className =
      state === "selected-invalid" || state === "upload-error" ? "status-error" : "";
    upload.disabled = state !== "selected-valid" && state !== "upload-error";
    input.disabled = state === "disabled" || state === "uploading";
  };

  if (!options.eventId) {
    setState("disabled", "Save the event first, then add a banner.");
    return container;
  }
  const eventId = options.eventId;
  setState("empty");

  const selectedFile = (): File | undefined => input.files?.[0];
  input.addEventListener("change", () => {
    const file = selectedFile();
    if (!file) {
      setState("empty");
      return;
    }
    const invalid = validateBannerFile(file);
    setState(invalid ? "selected-invalid" : "selected-valid", invalid ?? `Selected ${file.name}.`);
  });
  upload.addEventListener("click", () => {
    const file = selectedFile();
    if (!file) {
      return;
    }
    setState("uploading", COPY.bannerUploading);
    options.announce(COPY.bannerUploading);
    void uploadBanner(options.api, eventId, file, options.fetchImpl).then((result) => {
      if (result.ok) {
        preview.src = result.previewUrl;
        preview.hidden = false;
        setState("uploaded", COPY.bannerUploaded);
        options.announce(COPY.bannerUploaded);
        options.onUploaded?.(result.bannerReference);
      } else {
        setState("upload-error", result.message);
        options.announce(result.message);
      }
    });
  });
  return container;
}
