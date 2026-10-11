import { describe, expect, it } from "vitest";
import { resolveRegion } from "../../../src/config/region.js";

describe("deployment region configuration", () => {
  it.each(["us-east-1", "eu-west-1", "ap-south-1", "us-west-2"])(
    "uses the region from AWS_DEFAULT_REGION (%s)",
    (region) => {
      expect(resolveRegion(region)).toBe(region);
    },
  );

  it("rejects malformed region values instead of normalizing them", () => {
    expect(() => resolveRegion("US-EAST-1")).toThrow(/not a valid AWS region/);
    expect(() => resolveRegion(" eu-west-1")).toThrow(/not a valid AWS region/);
    expect(() => resolveRegion("ireland")).toThrow(/not a valid AWS region/);
  });
});
