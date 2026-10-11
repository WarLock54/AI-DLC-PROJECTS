import { describe, expect, it } from "vitest";
import {
  createAwsPorts,
  createTeardownClients,
  type TeardownClients,
} from "../../../scripts/teardown/aws-ports.js";

type Handler = (input: Record<string, unknown>) => unknown;

interface SentCommand {
  name: string;
  input: Record<string, unknown>;
}

/** A stand-in SDK client whose `send` dispatches on the command class name. */
function mockClient(handlers: Record<string, Handler>, sent: SentCommand[]) {
  return {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`Unexpected command ${name}`);
      }
      return handler(command.input);
    },
  };
}

function awsError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

function clientsWith(handlers: Partial<Record<keyof TeardownClients, Record<string, Handler>>>): {
  clients: TeardownClients;
  sent: SentCommand[];
} {
  const sent: SentCommand[] = [];
  const keys: Array<keyof TeardownClients> = [
    "cloudFormation",
    "tagging",
    "s3",
    "logs",
    "cognito",
    "dynamodb",
    "secrets",
  ];
  const clients = Object.fromEntries(
    keys.map((key) => [key, mockClient(handlers[key] ?? {}, sent)]),
  ) as unknown as TeardownClients;
  return { clients, sent };
}

// Waiters require maxWaitTime above their minimum delay; the first poll is immediate.
const LIMITS = { stackDeleteSeconds: 60, tableDeleteSeconds: 60 };

describe("createAwsPorts", () => {
  it("lists live stacks across pages and never asks for DELETE_COMPLETE stacks", async () => {
    const pages = [
      { StackSummaries: [{ StackName: "team32-ceb-foundation" }, {}], NextToken: "page-2" },
      { StackSummaries: [{ StackName: "CDKToolkit" }] },
    ];
    const { clients, sent } = clientsWith({
      cloudFormation: { ListStacksCommand: () => pages.shift() },
    });

    const names = await createAwsPorts(clients, LIMITS).listStackNames();

    expect(names).toEqual(["team32-ceb-foundation", "CDKToolkit"]);
    expect(sent[1].input.NextToken).toBe("page-2");
    const filter = sent[0].input.StackStatusFilter as string[];
    expect(filter).toContain("DELETE_FAILED");
    expect(filter).not.toContain("DELETE_COMPLETE");
  });

  it("deletes a stack and waits until CloudFormation reports it gone", async () => {
    const { clients, sent } = clientsWith({
      cloudFormation: {
        DeleteStackCommand: () => ({}),
        DescribeStacksCommand: () => {
          throw awsError("ValidationError", "Stack with id team32-ceb-foundation does not exist");
        },
      },
    });
    const ports = createAwsPorts(clients, LIMITS);

    await ports.deleteStack("team32-ceb-foundation");
    await ports.waitForStackDeleted("team32-ceb-foundation");

    expect(sent.map((command) => command.name)).toEqual([
      "DeleteStackCommand",
      "DescribeStacksCommand",
    ]);
  });

  it("lists tagged resources across pages with the project tag filter", async () => {
    const pages = [
      {
        ResourceTagMappingList: [{ ResourceARN: "arn:aws:s3:::team32-ceb-a" }, {}],
        PaginationToken: "t2",
      },
      {
        ResourceTagMappingList: [{ ResourceARN: "arn:aws:s3:::team32-ceb-b" }],
        PaginationToken: "",
      },
    ];
    const { clients, sent } = clientsWith({
      tagging: { GetResourcesCommand: () => pages.shift() },
    });

    const arns = await createAwsPorts(clients, LIMITS).listTaggedResourceArns();

    expect(arns).toEqual(["arn:aws:s3:::team32-ceb-a", "arn:aws:s3:::team32-ceb-b"]);
    expect(sent[0].input.TagFilters).toEqual([{ Key: "project", Values: ["team32-ceb"] }]);
    expect(sent).toHaveLength(2);
  });

  it("maps object versions and delete markers, carries the next marker, and reports a missing bucket", async () => {
    let call = 0;
    const { clients } = clientsWith({
      s3: {
        ListObjectVersionsCommand: (input) => {
          call += 1;
          if (input.Bucket === "team32-ceb-gone") {
            throw awsError("NoSuchBucket");
          }
          if (input.Bucket === "team32-ceb-denied") {
            throw awsError("AccessDenied");
          }
          return call === 1
            ? {
                Versions: [{ Key: "a.png", VersionId: "v1" }, { VersionId: "orphan" }],
                DeleteMarkers: [{ Key: "b.png" }],
                IsTruncated: true,
                NextKeyMarker: "b.png",
                NextVersionIdMarker: "v9",
              }
            : { Versions: [], IsTruncated: false };
        },
      },
    });
    const ports = createAwsPorts(clients, LIMITS);

    await expect(ports.listObjectVersions("team32-ceb-banner")).resolves.toEqual({
      versions: [
        { key: "a.png", versionId: "v1" },
        { key: "b.png", versionId: "null" },
      ],
      next: { keyMarker: "b.png", versionIdMarker: "v9" },
    });
    await expect(
      ports.listObjectVersions("team32-ceb-banner", { keyMarker: "b.png" }),
    ).resolves.toEqual({ versions: [] });
    await expect(ports.listObjectVersions("team32-ceb-gone")).resolves.toBe("absent");
    await expect(ports.listObjectVersions("team32-ceb-denied")).rejects.toThrow("AccessDenied");
  });

  it("deletes a page of versions quietly and fails when S3 reports per-key errors", async () => {
    const { clients, sent } = clientsWith({
      s3: {
        DeleteObjectsCommand: (input) =>
          (input.Bucket as string).endsWith("bad")
            ? { Errors: [{ Code: "AccessDenied" }, { Code: "AccessDenied" }, {}] }
            : {},
      },
    });
    const ports = createAwsPorts(clients, LIMITS);

    await ports.deleteObjectVersions("team32-ceb-good", [{ key: "a.png", versionId: "v1" }]);
    expect(sent[0].input.Delete).toEqual({
      Objects: [{ Key: "a.png", VersionId: "v1" }],
      Quiet: true,
    });
    await expect(
      ports.deleteObjectVersions("team32-ceb-bad", [{ key: "a.png", versionId: "v1" }]),
    ).rejects.toThrow("3 object version(s) could not be deleted (AccessDenied, Unknown).");
  });

  it.each([
    ["deleteBucket", "s3", "DeleteBucketCommand", "NoSuchBucket"],
    ["deleteLogGroup", "logs", "DeleteLogGroupCommand", "ResourceNotFoundException"],
    ["deleteUserPool", "cognito", "DeleteUserPoolCommand", "ResourceNotFoundException"],
    ["deleteSecret", "secrets", "DeleteSecretCommand", "ResourceNotFoundException"],
  ] as const)(
    "%s returns deleted, absent on %s-style not found, and rethrows other errors",
    async (method, clientKey, commandName, notFoundName) => {
      let mode: "ok" | "missing" | "denied" = "ok";
      const { clients } = clientsWith({
        [clientKey]: {
          [commandName]: () => {
            if (mode === "missing") {
              throw awsError(notFoundName);
            }
            if (mode === "denied") {
              throw awsError("AccessDeniedException");
            }
            return {};
          },
        },
      });
      const ports = createAwsPorts(clients, LIMITS);

      await expect(ports[method]("team32-ceb-x")).resolves.toBe("deleted");
      mode = "missing";
      await expect(ports[method]("team32-ceb-x")).resolves.toBe("absent");
      mode = "denied";
      await expect(ports[method]("team32-ceb-x")).rejects.toThrow("AccessDeniedException");
    },
  );

  it("force-deletes secrets with no recovery window", async () => {
    const { clients, sent } = clientsWith({ secrets: { DeleteSecretCommand: () => ({}) } });
    await createAwsPorts(clients, LIMITS).deleteSecret("team32-ceb-demo-credentials");
    expect(sent[0].input).toEqual({
      SecretId: "team32-ceb-demo-credentials",
      ForceDeleteWithoutRecovery: true,
    });
  });

  it("deletes a table and waits until it no longer exists; a missing table is absent", async () => {
    let tableExists = true;
    const { clients, sent } = clientsWith({
      dynamodb: {
        DeleteTableCommand: () => {
          if (!tableExists) {
            throw awsError("ResourceNotFoundException");
          }
          tableExists = false;
          return {};
        },
        DescribeTableCommand: () => {
          throw awsError("ResourceNotFoundException");
        },
      },
    });
    const ports = createAwsPorts(clients, LIMITS);

    await expect(ports.deleteTable("team32-ceb-events")).resolves.toBe("deleted");
    expect(sent.map((command) => command.name)).toEqual([
      "DeleteTableCommand",
      "DescribeTableCommand",
    ]);
    await expect(ports.deleteTable("team32-ceb-events")).resolves.toBe("absent");
  });
});

describe("createTeardownClients", () => {
  it("builds every client for the given region", async () => {
    const clients = createTeardownClients("us-east-1");
    expect(Object.keys(clients).sort()).toEqual([
      "cloudFormation",
      "cognito",
      "dynamodb",
      "logs",
      "s3",
      "secrets",
      "tagging",
    ]);
    await expect(clients.s3.config.region()).resolves.toBe("us-east-1");
  });
});
