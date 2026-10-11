// C4 (D3): Lambda entry point for the Node.js 22.x web-deployment custom
// resource. The function is the custom resource's service token, so it uploads
// the CloudFormation response itself (no Provider framework Lambda).
import { request } from "node:https";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  GetInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CloudFormationCustomResourceEvent } from "aws-lambda";
import { processEvent, type DeployResult, type WebDeployPorts } from "./deploy.js";

export function createAwsPorts(): WebDeployPorts {
  const s3 = new S3Client({});
  const cloudfront = new CloudFrontClient({});
  return {
    copyObject: async (input) => {
      await s3.send(
        new CopyObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          CopySource: `${input.sourceBucket}/${encodeURIComponent(input.sourceKey)}`,
          MetadataDirective: "REPLACE",
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
        }),
      );
    },
    putObject: async (input) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
        }),
      );
    },
    deleteObject: async (input) => {
      await s3.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
    },
    createInvalidation: async (input) => {
      const response = await cloudfront.send(
        new CreateInvalidationCommand({
          DistributionId: input.distributionId,
          InvalidationBatch: {
            CallerReference: input.callerReference,
            Paths: { Quantity: input.paths.length, Items: input.paths },
          },
        }),
      );
      const id = response.Invalidation?.Id;
      if (!id) {
        throw new Error("CloudFront returned no invalidation id.");
      }
      return id;
    },
    getInvalidationStatus: async (input) => {
      const response = await cloudfront.send(
        new GetInvalidationCommand({
          DistributionId: input.distributionId,
          Id: input.invalidationId,
        }),
      );
      return response.Invalidation?.Status ?? "Unknown";
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

export type ResponseSender = (url: string, body: string) => Promise<void>;

/** Uploads the CloudFormation response with an empty content type, like cfn-response. */
export const putResponse: ResponseSender = (url, body) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "PUT",
        headers: { "content-type": "", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300
            ? resolve()
            : reject(new Error(`CloudFormation response upload returned HTTP ${res.statusCode}.`)),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });

export function responseBody(
  event: CloudFormationCustomResourceEvent,
  result: DeployResult,
): string {
  return JSON.stringify({
    Status: result.status,
    Reason: result.reason ?? "See the team32-ceb-web-deployment log group.",
    PhysicalResourceId: result.physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: result.data ?? {},
  });
}

export async function handleEvent(
  event: CloudFormationCustomResourceEvent,
  ports: WebDeployPorts,
  send: ResponseSender,
): Promise<DeployResult> {
  const result = await processEvent(event, ports);
  // A failed upload throws so the Lambda error is visible in its log group.
  await send(event.ResponseURL, responseBody(event, result));
  return result;
}

export async function handler(event: CloudFormationCustomResourceEvent): Promise<void> {
  await handleEvent(event, createAwsPorts(), putResponse);
}
