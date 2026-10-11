import type { Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SES_CONTEXT, synthWiredApp } from "../support/app.js";

function errorMessages(stack: Stack, pattern: string): string[] {
  return Annotations.fromStack(stack)
    .findError("*", Match.stringLikeRegexp(pattern))
    .map(({ id, entry }) => `${id}: ${String(entry.data)}`);
}

function warningMessages(stack: Stack, pattern: string): string[] {
  return Annotations.fromStack(stack)
    .findWarning("*", Match.stringLikeRegexp(pattern))
    .map(({ id, entry }) => `${id}: ${String(entry.data)}`);
}

describe("C5 whole-app cdk-nag (NFR11, NFR23)", () => {
  it.each([
    ["the default log mode", {}],
    ["the debug-sandbox SES mode", SES_CONTEXT],
  ])("has no unsuppressed AwsSolutions or log-retention findings in %s", (_, context) => {
    const { foundation, asyncMonitoring } = synthWiredApp(context);
    for (const stack of [foundation, asyncMonitoring]) {
      expect(errorMessages(stack, "AwsSolutions-.*")).toEqual([]);
      expect(warningMessages(stack, "AwsSolutions-.*")).toEqual([]);
      expect(errorMessages(stack, "\\[LogRetention\\].*")).toEqual([]);
    }
  });
});
