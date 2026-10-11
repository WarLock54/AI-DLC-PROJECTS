import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { FoundationStack } from "../../../src/infrastructure/foundation-stack.js";

let cached: { stack: FoundationStack; template: Template } | undefined;

/** Synthesizes the shared stack (with C3 resources) once per test file. */
export function synthesizeFoundation(): { stack: FoundationStack; template: Template } {
  if (!cached) {
    const app = new App();
    const stack = new FoundationStack(app, "team32-ceb-foundation", {
      env: { region: "us-east-1" },
    });
    cached = { stack, template: Template.fromStack(stack) };
  }
  return cached;
}

export type CfnResource = { Type: string; Properties: Record<string, unknown> };

export function resourcesOfType(template: Template, type: string): [string, CfnResource][] {
  return Object.entries(template.findResources(type)) as [string, CfnResource][];
}
