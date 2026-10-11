// @vitest-environment node
import { App, Aspects, CfnResource } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import type { IConstruct } from "constructs";
import { describe, expect, it } from "vitest";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";

function nagErrors(stripC4Suppressions: boolean): string[] {
  const app = new App();
  const stack = new FoundationStack(app, "team32-ceb-foundation", {
    env: { region: "us-east-1" },
  });
  if (stripC4Suppressions) {
    // Positive control: clear the cdk-nag suppressions C4 recorded on its own
    // resources (everything under the WebUi construct).
    const visit = (node: IConstruct): void => {
      if (node instanceof CfnResource && node.node.path.includes("/WebUi/")) {
        node.addMetadata("cdk_nag", { rules_to_suppress: [] });
      }
      node.node.children.forEach(visit);
    };
    visit(stack);
  }
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  app.synth();
  return Annotations.fromStack(stack)
    .findError("*", Match.stringLikeRegexp("AwsSolutions-.*"))
    .map(({ id, entry }) => `${id}: ${String(entry.data).split(":")[0]}`);
}

describe("C4 cdk-nag AwsSolutions checks", () => {
  it("reports no unsuppressed AwsSolutions errors for the stack with the C4 web UI", () => {
    expect(nagErrors(false)).toEqual([]);
  });

  it("reports the C4 findings once the C4 suppressions are removed (positive control)", () => {
    const errors = nagErrors(true);
    expect(errors.every((error) => error.includes("/WebUi/"))).toBe(true);
    const rules = new Set(errors.map((error) => /AwsSolutions-[A-Z0-9]+/.exec(error)?.[0]));
    expect(rules).toEqual(new Set(["AwsSolutions-L1", "AwsSolutions-IAM5"]));
  });
});
