import { App, Aspects, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import * as s3 from "aws-cdk-lib/aws-s3";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";

describe("C1 foundation cdk-nag AwsSolutions checks", () => {
  it("synthesizes with no unsuppressed AwsSolutions errors", () => {
    const app = new App();
    const stack = new FoundationStack(app, "team32-ceb-foundation", {
      env: { region: "us-east-1" },
    });
    Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
    app.synth();

    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*"),
    );
    expect(errors.map(({ id, entry }) => `${id}: ${String(entry.data)}`)).toEqual([]);
  });

  it("reports AwsSolutions errors for a deliberately non-compliant control stack", () => {
    const app = new App();
    const stack = new Stack(app, "team32-ceb-nag-control", { env: { region: "us-east-1" } });
    new s3.Bucket(stack, "NonCompliantBucket");
    Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
    app.synth();

    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*"),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
