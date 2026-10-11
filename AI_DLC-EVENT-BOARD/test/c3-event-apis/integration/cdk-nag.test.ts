import { App, Aspects, CfnResource } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import type { IConstruct } from "constructs";
import { describe, expect, it } from "vitest";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";

function nagErrors(stripC3Suppressions: boolean): string[] {
  const app = new App();
  const stack = new FoundationStack(app, "team32-ceb-foundation", {
    env: { region: "us-east-1" },
  });
  if (stripC3Suppressions) {
    // Positive control: clear the cdk-nag suppressions C3 recorded on its own
    // resources (EventApi construct and its public routes on the shared API).
    const visit = (node: IConstruct): void => {
      if (node instanceof CfnResource && isC3Resource(node)) {
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

function isC3Resource(resource: CfnResource): boolean {
  const path = resource.node.path;
  return path.includes("/EventApi/") || /\/HttpApi\/(GET|POST)--api--(events|rsvps)/.test(path);
}

describe("C3 cdk-nag AwsSolutions checks", () => {
  it("reports no unsuppressed AwsSolutions errors for the stack with C3 resources", () => {
    expect(nagErrors(false)).toEqual([]);
  });

  it("reports C3 findings once the C3 suppressions are removed (positive control)", () => {
    const errors = nagErrors(true);
    const rules = new Set(errors.map((error) => /AwsSolutions-[A-Z0-9]+/.exec(error)?.[0]));
    expect(rules).toEqual(new Set(["AwsSolutions-L1", "AwsSolutions-APIG4", "AwsSolutions-IAM5"]));
    expect(errors.filter((error) => error.includes("AwsSolutions-L1"))).toHaveLength(3);
    expect(errors.filter((error) => error.includes("AwsSolutions-APIG4"))).toHaveLength(4);
  });
});
