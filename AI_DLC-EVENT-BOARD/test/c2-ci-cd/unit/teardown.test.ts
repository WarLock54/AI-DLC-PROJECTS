import { describe, expect, it } from "vitest";
import {
  describeResource,
  runTeardown,
  TeardownError,
  type DeletionOutcome,
  type ObjectVersion,
  type ObjectVersionPage,
  type TeardownPorts,
  type VersionPageMarker,
} from "../../../scripts/teardown/teardown.js";

// Synthetic identifiers only: the account below is an obviously fake placeholder.
const ACCOUNT = "000000000000";
const REGION = "us-east-1";
const BUCKET = `team32-ceb-web-${ACCOUNT}-${REGION}`;
const ARN = {
  bucket: `arn:aws:s3:::${BUCKET}`,
  logGroup: `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:team32-ceb-health`,
  userPool: `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${REGION}_Synthetic1`,
  table: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/team32-ceb-events`,
  secret: `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:team32-ceb-demo-credentials-AbCdEf`,
  staleStack: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/team32-ceb-foundation/1111-2222`,
  lambda: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:team32-ceb-mystery`,
};

interface FakeOptions {
  stacks?: string[];
  tagged?: string[];
  bucketVersions?: ObjectVersion[];
  pageSize?: number;
  /** Extra ARNs the tag index still reports for the first N listings. */
  staleArns?: string[];
  staleListings?: number;
  /** Operation keys such as `deleteBucket` that throw. */
  failOn?: Record<string, Error>;
  /** Stack names whose first deletion fails (dependency still present). */
  stacksFailingOnce?: string[];
}

class FakeAws implements TeardownPorts {
  readonly calls: string[] = [];
  readonly stacks: Set<string>;
  tagged: string[];
  bucketVersions: ObjectVersion[];
  private taggedListings = 0;
  private readonly failedOnce = new Set<string>();

  constructor(private readonly options: FakeOptions = {}) {
    this.stacks = new Set(options.stacks ?? []);
    this.tagged = [...(options.tagged ?? [])];
    this.bucketVersions = [...(options.bucketVersions ?? [])];
  }

  private record(call: string): void {
    this.calls.push(call);
    const failure = this.options.failOn?.[call.split(":")[0]];
    if (failure) {
      throw failure;
    }
  }

  private removeTagged(arn: string): DeletionOutcome {
    const before = this.tagged.length;
    this.tagged = this.tagged.filter((entry) => entry !== arn);
    return this.tagged.length < before ? "deleted" : "absent";
  }

  async listStackNames(): Promise<string[]> {
    this.record("listStackNames");
    return [...this.stacks];
  }

  async deleteStack(name: string): Promise<void> {
    this.record(`deleteStack:${name}`);
  }

  async waitForStackDeleted(name: string): Promise<void> {
    this.record(`waitForStackDeleted:${name}`);
    if (this.options.stacksFailingOnce?.includes(name) && !this.failedOnce.has(name)) {
      this.failedOnce.add(name);
      throw new Error("Stack is in DELETE_FAILED state");
    }
    this.stacks.delete(name);
  }

  async listTaggedResourceArns(): Promise<string[]> {
    this.record("listTaggedResourceArns");
    this.taggedListings += 1;
    const stale =
      this.taggedListings <= (this.options.staleListings ?? 0)
        ? (this.options.staleArns ?? [])
        : [];
    return [...this.tagged, ...stale];
  }

  async listObjectVersions(
    bucket: string,
    marker?: VersionPageMarker,
  ): Promise<ObjectVersionPage | "absent"> {
    this.record(`listObjectVersions:${bucket}:${marker?.keyMarker ?? "start"}`);
    const pageSize = this.options.pageSize ?? 1000;
    const start = marker ? Number(marker.keyMarker) : 0;
    const versions = this.bucketVersions.slice(start, start + pageSize);
    const end = start + pageSize;
    return end < this.bucketVersions.length
      ? { versions, next: { keyMarker: String(end) } }
      : { versions };
  }

  async deleteObjectVersions(bucket: string, versions: ObjectVersion[]): Promise<void> {
    this.record(`deleteObjectVersions:${bucket}:${versions.length}`);
  }

  async deleteBucket(bucket: string): Promise<DeletionOutcome> {
    this.record(`deleteBucket:${bucket}`);
    return this.removeTagged(`arn:aws:s3:::${bucket}`);
  }

  async deleteLogGroup(name: string): Promise<DeletionOutcome> {
    this.record(`deleteLogGroup:${name}`);
    return this.removeTagged(ARN.logGroup);
  }

  async deleteUserPool(userPoolId: string): Promise<DeletionOutcome> {
    this.record(`deleteUserPool:${userPoolId}`);
    return this.removeTagged(ARN.userPool);
  }

  async deleteTable(name: string): Promise<DeletionOutcome> {
    this.record(`deleteTable:${name}`);
    return this.removeTagged(ARN.table);
  }

  async deleteSecret(secretArn: string): Promise<DeletionOutcome> {
    this.record(`deleteSecret:${secretArn === ARN.secret ? "by-arn" : "unexpected-id"}`);
    return this.removeTagged(ARN.secret);
  }
}

function harness(fake: FakeAws, environment: Record<string, string | undefined> = {}) {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const run = () =>
    runTeardown({
      ports: fake,
      environment: { TEARDOWN: "true", ...environment },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      logger: { info: (message) => logs.push(message) },
      inventoryAttempts: 3,
      inventoryDelayMs: 5,
    });
  return { logs, sleeps, run };
}

function expectNoArnOrAccount(text: string): void {
  expect(text).not.toMatch(/arn:aws/);
  expect(text).not.toMatch(/(?<!\d)\d{12}(?!\d)/);
}

describe("runTeardown", () => {
  it.each([undefined, "false", "TRUE", "1"])(
    "refuses before any AWS call when TEARDOWN is %s",
    async (value) => {
      const fake = new FakeAws({ stacks: ["team32-ceb-foundation"] });
      const { run } = harness(fake, { TEARDOWN: value });
      await expect(run()).rejects.toThrow(/TEARDOWN=true must be set explicitly/);
      expect(fake.calls).toEqual([]);
    },
  );

  it("deletes only team32-ceb- stacks and waits for them before touching retained resources", async () => {
    const fake = new FakeAws({
      stacks: ["CDKToolkit", "team32-ceb-foundation", "other-stack", "team32-ceb-monitoring"],
      tagged: [ARN.logGroup],
    });
    const { run } = harness(fake);

    const report = await run();

    expect(report.stacksDeleted).toEqual(["team32-ceb-foundation", "team32-ceb-monitoring"]);
    expect([...fake.stacks]).toEqual(["CDKToolkit", "other-stack"]);
    expect(fake.calls.filter((call) => call.startsWith("deleteStack"))).toEqual([
      "deleteStack:team32-ceb-foundation",
      "deleteStack:team32-ceb-monitoring",
    ]);
    const lastStackWait = fake.calls.lastIndexOf("waitForStackDeleted:team32-ceb-monitoring");
    const firstRetainedDelete = fake.calls.indexOf("deleteLogGroup:team32-ceb-health");
    expect(lastStackWait).toBeGreaterThan(-1);
    expect(firstRetainedDelete).toBeGreaterThan(lastStackWait);
  });

  it("retries a stack whose deletion failed once and fails loudly when no stack can be deleted", async () => {
    const recovering = new FakeAws({
      stacks: ["team32-ceb-foundation", "team32-ceb-monitoring"],
      stacksFailingOnce: ["team32-ceb-foundation"],
    });
    const report = await harness(recovering).run();
    expect(report.stacksDeleted).toEqual(["team32-ceb-monitoring", "team32-ceb-foundation"]);

    const stuck = new FakeAws({
      stacks: ["team32-ceb-foundation"],
      failOn: { deleteStack: Object.assign(new Error("Access denied"), { name: "AccessDenied" }) },
    });
    await expect(harness(stuck).run()).rejects.toThrow(
      /Failed to delete CloudFormation stack team32-ceb-foundation \(AccessDenied: Access denied\)/,
    );
  });

  it("empties a versioned bucket across pages, including delete markers, before deleting it", async () => {
    const versions = Array.from({ length: 5 }, (_, index) => ({
      key: index % 2 === 0 ? `banners/${index}.png` : `banners/${index}.png#delete-marker`,
      versionId: `v${index}`,
    }));
    const fake = new FakeAws({ tagged: [ARN.bucket], bucketVersions: versions, pageSize: 2 });
    const { run, logs } = harness(fake);

    const report = await run();

    const bucketCalls = fake.calls.filter((call) => call.includes(BUCKET));
    expect(bucketCalls).toEqual([
      `listObjectVersions:${BUCKET}:start`,
      `deleteObjectVersions:${BUCKET}:2`,
      `listObjectVersions:${BUCKET}:2`,
      `deleteObjectVersions:${BUCKET}:2`,
      `listObjectVersions:${BUCKET}:4`,
      `deleteObjectVersions:${BUCKET}:1`,
      `deleteBucket:${BUCKET}`,
    ]);
    expect(report.resourcesDeleted).toEqual([`S3 bucket ${BUCKET}`]);
    expect(logs.join("\n")).toContain("(5 object version(s) and delete marker(s))");
  });

  it("deletes the retained log group, user pool, table, and secret and proves an empty inventory", async () => {
    const fake = new FakeAws({
      stacks: ["team32-ceb-foundation"],
      tagged: [ARN.logGroup, ARN.userPool, ARN.table, ARN.secret],
    });
    const { run, logs } = harness(fake);

    const report = await run();

    expect(fake.calls).toEqual(
      expect.arrayContaining([
        "deleteLogGroup:team32-ceb-health",
        `deleteUserPool:${REGION}_Synthetic1`,
        "deleteTable:team32-ceb-events",
        "deleteSecret:by-arn",
      ]),
    );
    expect(report.resourcesDeleted).toHaveLength(4);
    expect(logs.at(-1)).toMatch(/Inventory check passed/);
    expectNoArnOrAccount(logs.join("\n"));
  });

  it("reports an unknown tagged resource type as a leftover and fails after the polling bound", async () => {
    const fake = new FakeAws({ tagged: [ARN.lambda] });
    const { run, sleeps, logs } = harness(fake);

    const failure = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TeardownError);
    expect((failure as Error).message).toMatch(
      /Teardown incomplete after 3 inventory check\(s\); 1 item\(s\) remain: lambda function team32-ceb-mystery/,
    );
    expect(sleeps).toEqual([5, 5]);
    expect(fake.calls.some((call) => call.includes("mystery") && call.startsWith("delete"))).toBe(
      false,
    );
    expectNoArnOrAccount([(failure as Error).message, ...logs].join("\n"));
  });

  it("succeeds when tag-index lag clears within the polling bound", async () => {
    const fake = new FakeAws({
      stacks: ["team32-ceb-foundation"],
      staleArns: [ARN.staleStack],
      staleListings: 2,
    });
    const { run, sleeps, logs } = harness(fake);

    await expect(run()).resolves.toMatchObject({ stacksDeleted: ["team32-ceb-foundation"] });
    expect(sleeps).toEqual([5]);
    expect(logs.join("\n")).toContain(
      "Inventory check 1/3: 1 item(s) remain: CloudFormation stack team32-ceb-foundation",
    );
  });

  it("fails loudly with type and name when AWS denies a deletion, without leaking ARNs or account IDs", async () => {
    const accessDenied = Object.assign(
      new Error(
        `User: arn:aws:iam::${ACCOUNT}:user/ci is not authorized to perform: s3:DeleteBucket`,
      ),
      { name: "AccessDenied" },
    );
    const fake = new FakeAws({
      tagged: [ARN.bucket, ARN.table],
      failOn: { deleteBucket: accessDenied },
    });
    const { run, logs } = harness(fake);

    const failure = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TeardownError);
    const message = (failure as Error).message;
    expect(message).toMatch(
      /^Failed to delete S3 bucket team32-ceb-web-\[account\]-us-east-1: AccessDenied/,
    );
    expect((failure as Error).cause).toBe(accessDenied);
    // The table after the failing bucket is not attempted: the run stops at the first failure.
    expect(fake.calls).not.toContain("deleteTable:team32-ceb-events");
    expectNoArnOrAccount([message, ...logs].join("\n"));
  });

  it("treats an already-deleted retained resource as absent on a rerun", async () => {
    const fake = new FakeAws({ tagged: [ARN.logGroup] });
    fake.deleteLogGroup = async (name) => {
      fake.calls.push(`deleteLogGroup:${name}`);
      fake.tagged = [];
      return "absent";
    };
    const { run, logs } = harness(fake);

    const report = await run();

    expect(report.resourcesAlreadyAbsent).toEqual(["CloudWatch log group team32-ceb-health"]);
    expect(logs).toContain("Already absent: CloudWatch log group team32-ceb-health.");
  });

  it("refuses an inventory bound that would never check anything", async () => {
    const fake = new FakeAws();
    await expect(
      runTeardown({
        ports: fake,
        environment: { TEARDOWN: "true" },
        sleep: async () => {},
        logger: { info: () => undefined },
        inventoryAttempts: 0,
      }),
    ).rejects.toThrow(/inventoryAttempts must be an integer of at least 1/);
    expect(fake.calls).toEqual([]);
  });
});

describe("describeResource", () => {
  it.each([
    [ARN.bucket, "s3-bucket", BUCKET],
    [`${ARN.logGroup}:*`, "log-group", "team32-ceb-health"],
    [ARN.userPool, "user-pool", `${REGION}_Synthetic1`],
    [ARN.table, "dynamodb-table", "team32-ceb-events"],
    [`${ARN.table}/index/by-date`, "other", "team32-ceb-events/index/by-date"],
    [ARN.secret, "secret", "team32-ceb-demo-credentials-AbCdEf"],
    [ARN.staleStack, "cloudformation-stack", "team32-ceb-foundation"],
    [ARN.lambda, "other", "team32-ceb-mystery"],
    ["not-an-arn", "other", "[unparseable]"],
  ])("classifies %s", (arn, kind, name) => {
    expect(describeResource(arn)).toMatchObject({ kind, name });
  });
});
