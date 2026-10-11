import { describe, expect, it } from "vitest";
import { COPY } from "../../../ui/src/copy.js";
import { liveText, setValue, startApp, type Harness } from "./support/app.js";
import { FakeApi, flush } from "./support/fake-api.js";
import { organizerSession } from "./support/jwt.js";

function choose(harness: Harness, file: File): void {
  const input = harness.byTestId<HTMLInputElement>("banner-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function png(size: number): File {
  return new File([new Uint8Array(size)], "banner.png", { type: "image/png" });
}

async function editFirstEvent(api?: FakeApi): Promise<Harness> {
  const harness = await startApp("/organizer/events", { session: organizerSession(), api });
  harness.allByTestId("manage-edit")[0].click();
  return harness;
}

describe("banner uploader states (D14, US2.3)", () => {
  it("shows the type and 5 MB rule before any file is selected", async () => {
    const harness = await editFirstEvent();
    expect(harness.byTestId("banner-hint").textContent).toBe(
      "JPEG, PNG, or WebP image; maximum 5 MB.",
    );
    expect(harness.byTestId("banner-file").getAttribute("aria-describedby")).toContain(
      "banner-hint",
    );
    expect(harness.byTestId("banner-file").getAttribute("accept")).toBe(
      "image/jpeg,image/png,image/webp",
    );
    expect(harness.byTestId<HTMLButtonElement>("banner-upload").disabled).toBe(true);
  });

  it("rejects an oversized file without any request", async () => {
    const harness = await editFirstEvent();
    choose(harness, png(5_242_881));
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("selected-invalid");
    expect(harness.byTestId("banner-status").textContent).toBe(COPY.bannerRule);
    expect(harness.byTestId<HTMLButtonElement>("banner-upload").disabled).toBe(true);
    expect(harness.api.requestsTo("POST", /banner-upload$/)).toHaveLength(0);
  });

  it("announces the upload while it is in progress", async () => {
    const api = new FakeApi();
    let release: () => void = () => undefined;
    api.on("POST", /^\/$/, async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { status: 204 };
    });
    const harness = await editFirstEvent(api);
    choose(harness, png(1024));
    harness.byTestId("banner-upload").click();
    await flush();
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("uploading");
    expect(liveText()).toBe(COPY.bannerUploading);
    expect(harness.byTestId<HTMLInputElement>("banner-file").disabled).toBe(true);
    release();
    await flush();
  });

  it("shows the preview after a successful upload", async () => {
    const harness = await editFirstEvent();
    choose(harness, png(1024));
    harness.byTestId("banner-upload").click();
    await flush();
    const preview = harness.byTestId<HTMLImageElement>("banner-preview");
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("uploaded");
    expect(preview.hidden).toBe(false);
    expect(preview.getAttribute("src")).toBe("/banners/seed-event-community-market/upload-1.png");
  });

  it("shows the 5 MB message on an S3 rejection and keeps the event form values", async () => {
    const harness = await editFirstEvent();
    harness.api.on("POST", /^\/$/, () => ({
      status: 403,
      text: "<Error><Code>AccessDenied</Code><Message>Invalid according to Policy</Message></Error>",
      contentType: "application/xml",
    }));
    setValue(harness.byTestId<HTMLInputElement>("event-form-title"), "Unsaved Title Edit");
    choose(harness, png(1024));
    harness.byTestId("banner-upload").click();
    await flush();
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("upload-error");
    expect(harness.byTestId("banner-status").textContent).toBe(COPY.bannerRule);
    expect(harness.byTestId<HTMLInputElement>("event-form-title").value).toBe("Unsaved Title Edit");
    expect(harness.byTestId<HTMLButtonElement>("banner-upload").disabled).toBe(false);
  });

  it("is only enabled for an existing event", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    harness.byTestId("manage-create").click();
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("disabled");
    expect(harness.byTestId<HTMLInputElement>("banner-file").disabled).toBe(true);
    expect(harness.byTestId<HTMLButtonElement>("banner-upload").disabled).toBe(true);
  });
});
