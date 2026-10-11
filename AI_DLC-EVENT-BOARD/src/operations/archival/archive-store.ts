import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** C-07 object storage port; tests pass an in-memory fake. */
export interface ArchiveStore {
  /** Writes (or, on a v1 rerun, overwrites) one archive object. Throws on failure. */
  putObject(key: string, body: string): Promise<void>;
}

export class S3ArchiveStore implements ArchiveStore {
  constructor(
    private readonly client: Pick<S3Client, "send">,
    private readonly bucketName: string,
  ) {}

  async putObject(key: string, body: string): Promise<void> {
    if (!key.startsWith("archive/")) {
      throw new Error("Archive objects must be written under the archive/ prefix.");
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    );
  }
}
