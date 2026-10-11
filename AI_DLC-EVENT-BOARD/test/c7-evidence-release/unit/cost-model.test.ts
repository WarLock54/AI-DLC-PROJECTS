import { describe, expect, it } from "vitest";
import {
  COST_TARGET_USD,
  EXPECTED_TRAFFIC,
  PRICES,
  estimateMonthlyCost,
  renderCostNotes,
} from "../../../scripts/evidence/cost-model.js";

describe("cost model (NFR9)", () => {
  it("keeps the approved target at $30", () => {
    expect(COST_TARGET_USD).toBe(30);
  });

  it("keeps the expected-traffic scenario under $30 per month", () => {
    const estimate = estimateMonthlyCost(EXPECTED_TRAFFIC);
    expect(estimate.totalUsd).toBeLessThan(30);
    expect(estimate.withinTarget).toBe(true);
    expect(estimate.totalUsd).toBeGreaterThan(estimate.subtotalUsd);
  });

  it("has a line item for every service the solution uses", () => {
    const ids = estimateMonthlyCost(EXPECTED_TRAFFIC).lineItems.map((item) => item.id);
    expect(ids).toEqual([
      "lambda",
      "api-gateway",
      "dynamodb",
      "s3",
      "cloudfront",
      "sqs",
      "cloudwatch",
      "secrets-manager",
      "scheduler",
      "sns",
      "cognito",
      "ses",
    ]);
    expect(estimateMonthlyCost(EXPECTED_TRAFFIC).lineItems.every((i) => i.justification)).toBe(
      true,
    );
  });

  it("changes the total when an assumption changes", () => {
    const base = estimateMonthlyCost(EXPECTED_TRAFFIC).totalUsd;
    const more = estimateMonthlyCost({ ...EXPECTED_TRAFFIC, cloudFrontTransferGb: 40 }).totalUsd;
    expect(more).toBeCloseTo(base + 20 * PRICES.cloudFrontPerGbTransfer * 1.25, 6);
  });

  it("reports a breach for a deliberately inflated scenario instead of passing", () => {
    const inflated = estimateMonthlyCost({
      ...EXPECTED_TRAFFIC,
      name: "Inflated",
      apiRequestsPerMonth: 200_000_000,
      cloudFrontTransferGb: 2000,
    });
    expect(inflated.withinTarget).toBe(false);
    const markdown = renderCostNotes(inflated);
    expect(markdown).toContain("TARGET BREACHED");
    expect(markdown).not.toContain("within target");
  });

  it("rejects negative or non-finite scenario values", () => {
    expect(() => estimateMonthlyCost({ ...EXPECTED_TRAFFIC, alarms: -1 })).toThrow(/alarms/);
    expect(() => estimateMonthlyCost({ ...EXPECTED_TRAFFIC, logIngestGb: Number.NaN })).toThrow(
      /logIngestGb/,
    );
  });

  it("renders assumptions, every line item, and the total", () => {
    const markdown = renderCostNotes(estimateMonthlyCost(EXPECTED_TRAFFIC));
    for (const text of [
      "## Assumptions",
      "AWS Lambda",
      "Amazon CloudFront",
      "**Total**",
      "within target",
    ]) {
      expect(markdown).toContain(text);
    }
  });
});
