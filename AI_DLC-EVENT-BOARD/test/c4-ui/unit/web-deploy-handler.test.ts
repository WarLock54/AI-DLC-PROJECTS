// @vitest-environment node
import { EventEmitter } from "node:events";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { S3Client } from "@aws-sdk/client-s3";
import type { CloudFormationCustomResourceEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  NO_CACHE,
  processEvent,
  SHORT_CACHE,
  type WebDeployPorts,
} from "../../../src/lambda/web-deploy/deploy.js";
import {
  createAwsPorts,
  handleEvent,
  putResponse,
  responseBody,
} from "../../../src/lambda/web-deploy/handler.js";

const https = vi.hoisted(() => ({
  statusCode: 200,
  body: "",
  headers: {} as Record<string, unknown>,
}));

vi.mock("node:https", () => ({
  request: (
    _url: string,
    options: { headers: Record<string, unknown> },
    callback: (res: EventEmitter & { statusCode: number; resume: () => void }) => void,
  ) => {
    https.headers = options.headers;
    const req = new EventEmitter() as EventEmitter & { end: (body: string) => void };
    req.end = (body: string) => {
      https.body = body;
      const res = Object.assign(new EventEmitter(), {
        statusCode: https.statusCode,
        resume: () => undefined,
      });
      callback(res);
      res.emit("end");
    };
    return req;
  },
}));

const PROPS = {
  ServiceToken: "synthetic-service-token",
  DestinationBucket: "team32-ceb-web-test-bucket",
  DistributionId: "E1TESTDISTRIB0",
  Files: [
    { Key: "index.html", SourceBucket: "cdk-assets-test-bucket", SourceKey: "aaaa1111.html" },
    { Key: "app.js", SourceBucket: "cdk-assets-test-bucket", SourceKey: "bbbb2222.js" },
    { Key: "styles.css", SourceBucket: "cdk-assets-test-bucket", SourceKey: "cccc3333.css" },
  ],
  Config: {
    Region: "us-east-1",
    UserPoolId: "us-east-1_TestPool1",
    UserPoolClientId: "testclient123",
  },
  InvalidationPaths: ["/index.html", "/config.json", "/app.js", "/styles.css"],
};

function event(
  RequestType: "Create" | "Update" | "Delete",
  ResourceProperties: Record<string, unknown> = PROPS,
  OldResourceProperties?: Record<string, unknown>,
): CloudFormationCustomResourceEvent {
  return {
    RequestType,
    ServiceToken: "synthetic-service-token",
    ResponseURL: "https://cfn-response.test/synthetic",
    StackId: "synthetic-stack",
    RequestId: "request-1",
    LogicalResourceId: "WebUiWebDeployment",
    ResourceType: "Custom::Team32CebWebDeployment",
    ResourceProperties,
    ...(RequestType === "Create" ? {} : { PhysicalResourceId: "team32-ceb-web-deployment-old" }),
    ...(OldResourceProperties ? { OldResourceProperties } : {}),
  } as unknown as CloudFormationCustomResourceEvent;
}

function fakePorts(statuses: string[] = ["InProgress", "Completed"]) {
  let clock = 0;
  const ports = {
    copyObject: vi.fn<WebDeployPorts["copyObject"]>(async () => undefined),
    putObject: vi.fn<WebDeployPorts["putObject"]>(async () => undefined),
    deleteObject: vi.fn<WebDeployPorts["deleteObject"]>(async () => undefined),
    createInvalidation: vi.fn<WebDeployPorts["createInvalidation"]>(async () => "INVALIDATION1"),
    getInvalidationStatus: vi.fn<WebDeployPorts["getInvalidationStatus"]>(
      async () => statuses.shift() ?? "InProgress",
    ),
    sleep: vi.fn<WebDeployPorts["sleep"]>(async (ms: number) => {
      clock += ms;
    }),
    now: vi.fn<WebDeployPorts["now"]>(() => clock),
    log: vi.fn<WebDeployPorts["log"]>(),
  } satisfies WebDeployPorts;
  return ports;
}

describe("web deployment custom resource (D3)", () => {
  it("publishes the files with content types and caching, writes config.json, and invalidates", async () => {
    const ports = fakePorts();
    const result = await processEvent(event("Create"), ports, {
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
    });
    expect(result).toEqual({
      status: "SUCCESS",
      physicalResourceId: "team32-ceb-web-deployment-team32-ceb-web-test-bucket",
      data: { InvalidationId: "INVALIDATION1", InvalidationStatus: "Completed" },
    });
    expect(ports.copyObject.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        key: "index.html",
        sourceKey: "aaaa1111.html",
        contentType: "text/html; charset=utf-8",
        cacheControl: NO_CACHE,
      }),
      expect.objectContaining({
        key: "app.js",
        contentType: "text/javascript; charset=utf-8",
        cacheControl: SHORT_CACHE,
      }),
      expect.objectContaining({ key: "styles.css", contentType: "text/css; charset=utf-8" }),
    ]);
    expect(ports.putObject).toHaveBeenCalledWith({
      bucket: "team32-ceb-web-test-bucket",
      key: "config.json",
      body: JSON.stringify({
        region: "us-east-1",
        userPoolId: "us-east-1_TestPool1",
        userPoolClientId: "testclient123",
      }),
      contentType: "application/json",
      cacheControl: NO_CACHE,
    });
    expect(ports.createInvalidation).toHaveBeenCalledWith({
      distributionId: "E1TESTDISTRIB0",
      paths: PROPS.InvalidationPaths,
      callerReference: "team32-ceb-web-deployment-request-1",
    });
    expect(ports.deleteObject).not.toHaveBeenCalled();
  });

  it("prunes only objects it wrote before that are no longer published", async () => {
    const ports = fakePorts(["Completed"]);
    const old = {
      ...PROPS,
      Files: [
        ...PROPS.Files,
        { Key: "legacy.js", SourceBucket: "cdk-assets-test-bucket", SourceKey: "dddd.js" },
      ],
    };
    const result = await processEvent(event("Update", PROPS, old), ports);
    expect(result.status).toBe("SUCCESS");
    expect(ports.deleteObject.mock.calls).toEqual([
      [{ bucket: "team32-ceb-web-test-bucket", key: "legacy.js" }],
    ]);
  });

  it("fails clearly when a copy fails and creates no invalidation", async () => {
    const ports = fakePorts();
    ports.copyObject.mockImplementation(async (input: { key: string }) => {
      if (input.key === "app.js") {
        throw Object.assign(new Error("Access Denied for arn:aws:s3:::secret-detail"), {
          name: "AccessDenied",
        });
      }
    });
    const result = await processEvent(event("Create"), ports);
    expect(result).toMatchObject({
      status: "FAILED",
      reason: "Copying app.js into the web bucket failed: AccessDenied.",
    });
    expect(result.reason).not.toContain("arn:");
    expect(ports.putObject).not.toHaveBeenCalled();
    expect(ports.createInvalidation).not.toHaveBeenCalled();
  });

  it("fails clearly when the CloudFront invalidation cannot be created or read", async () => {
    const create = fakePorts();
    create.createInvalidation.mockRejectedValue(
      Object.assign(new Error("x"), { name: "TooManyInvalidationsInProgress" }),
    );
    await expect(processEvent(event("Create"), create)).resolves.toMatchObject({
      status: "FAILED",
      reason: "Creating the CloudFront invalidation failed: TooManyInvalidationsInProgress.",
    });
    const read = fakePorts();
    read.getInvalidationStatus.mockRejectedValue(new Error("x"));
    await expect(processEvent(event("Create"), read)).resolves.toMatchObject({
      status: "FAILED",
      reason: "Reading the CloudFront invalidation status failed: UnknownError.",
    });
  });

  it("rejects invalid properties before touching any bucket", async () => {
    const ports = fakePorts();
    const cases: Record<string, unknown>[] = [
      { ...PROPS, Config: { ...PROPS.Config, UserPoolId: "" } },
      { ...PROPS, DestinationBucket: "Not A Bucket" },
      { ...PROPS, Files: [] },
      {
        ...PROPS,
        Files: [
          { Key: "config.json", SourceBucket: "cdk-assets-test-bucket", SourceKey: "e.json" },
        ],
      },
      {
        ...PROPS,
        Files: [{ Key: "../escape.js", SourceBucket: "cdk-assets-test-bucket", SourceKey: "e.js" }],
      },
      {
        ...PROPS,
        Files: [{ Key: "image.gif", SourceBucket: "cdk-assets-test-bucket", SourceKey: "e.gif" }],
      },
      { ...PROPS, InvalidationPaths: ["index.html"] },
    ];
    for (const properties of cases) {
      const result = await processEvent(event("Create", properties), ports);
      expect(result.status).toBe("FAILED");
      expect(result.reason).toMatch(/^Invalid web deployment properties: /);
    }
    expect(ports.copyObject).not.toHaveBeenCalled();
    expect(ports.putObject).not.toHaveBeenCalled();
  });

  it("does nothing destructive on Delete", async () => {
    const ports = fakePorts();
    await expect(processEvent(event("Delete"), ports)).resolves.toEqual({
      status: "SUCCESS",
      physicalResourceId: "team32-ceb-web-deployment-old",
    });
    expect(ports.deleteObject).not.toHaveBeenCalled();
    expect(ports.copyObject).not.toHaveBeenCalled();
  });

  it("reports an invalidation still in progress after the wait window without failing", async () => {
    const ports = fakePorts(["InProgress", "InProgress", "InProgress"]);
    const result = await processEvent(event("Create"), ports, {
      waitTimeoutMs: 2_000,
      pollIntervalMs: 1_000,
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      data: { InvalidationId: "INVALIDATION1", InvalidationStatus: "InProgress" },
    });
    expect(ports.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "WEB_DEPLOY_INVALIDATION_PENDING" }),
    );
  });

  it("uploads the CloudFormation response and surfaces upload failures", async () => {
    const send = vi.fn(async () => undefined);
    const failed = fakePorts();
    failed.putObject.mockRejectedValue(Object.assign(new Error("x"), { name: "SlowDown" }));
    await handleEvent(event("Create"), failed, send);
    const [url, body] = send.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("https://cfn-response.test/synthetic");
    expect(JSON.parse(body)).toEqual({
      Status: "FAILED",
      Reason: "Writing config.json into the web bucket failed: SlowDown.",
      PhysicalResourceId: "team32-ceb-web-deployment-team32-ceb-web-test-bucket",
      StackId: "synthetic-stack",
      RequestId: "request-1",
      LogicalResourceId: "WebUiWebDeployment",
      Data: {},
    });
    const rejecting = vi.fn(async () => {
      throw new Error("upload failed");
    });
    await expect(handleEvent(event("Delete"), fakePorts(), rejecting)).rejects.toThrow(
      "upload failed",
    );
  });

  it("PUTs the response with an empty content type and rejects a non-2xx answer", async () => {
    const body = responseBody(event("Delete"), { status: "SUCCESS", physicalResourceId: "p" });
    https.statusCode = 200;
    await putResponse("https://cfn-response.test/synthetic", body);
    expect(https.body).toBe(body);
    expect(https.headers).toEqual({
      "content-type": "",
      "content-length": Buffer.byteLength(body),
    });
    https.statusCode = 403;
    await expect(putResponse("https://cfn-response.test/synthetic", body)).rejects.toThrow(
      "HTTP 403",
    );
  });

  it("maps the ports onto S3 and CloudFront commands", async () => {
    const s3Send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const cloudfrontSend = vi
      .spyOn(CloudFrontClient.prototype, "send")
      .mockResolvedValueOnce({ Invalidation: { Id: "INV2" } } as never)
      .mockResolvedValueOnce({ Invalidation: { Status: "Completed" } } as never)
      .mockResolvedValueOnce({} as never);
    const ports = createAwsPorts();
    await ports.copyObject({
      sourceBucket: "cdk-assets-test-bucket",
      sourceKey: "bbbb2222.js",
      bucket: "team32-ceb-web-test-bucket",
      key: "app.js",
      contentType: "text/javascript; charset=utf-8",
      cacheControl: SHORT_CACHE,
    });
    await ports.putObject({
      bucket: "b",
      key: "config.json",
      body: "{}",
      contentType: "application/json",
      cacheControl: NO_CACHE,
    });
    await ports.deleteObject({ bucket: "b", key: "legacy.js" });
    const inputs = s3Send.mock.calls.map(([command]) => (command as { input: unknown }).input);
    expect(inputs[0]).toEqual({
      Bucket: "team32-ceb-web-test-bucket",
      Key: "app.js",
      CopySource: "cdk-assets-test-bucket/bbbb2222.js",
      MetadataDirective: "REPLACE",
      ContentType: "text/javascript; charset=utf-8",
      CacheControl: SHORT_CACHE,
    });
    expect(inputs[1]).toMatchObject({ Key: "config.json", CacheControl: NO_CACHE });
    expect(inputs[2]).toEqual({ Bucket: "b", Key: "legacy.js" });
    await expect(
      ports.createInvalidation({ distributionId: "E1", paths: ["/a"], callerReference: "r" }),
    ).resolves.toBe("INV2");
    await expect(
      ports.getInvalidationStatus({ distributionId: "E1", invalidationId: "INV2" }),
    ).resolves.toBe("Completed");
    await expect(
      ports.createInvalidation({ distributionId: "E1", paths: ["/a"], callerReference: "r" }),
    ).rejects.toThrow("no invalidation id");
    expect(cloudfrontSend).toHaveBeenCalledTimes(3);
  });
});
