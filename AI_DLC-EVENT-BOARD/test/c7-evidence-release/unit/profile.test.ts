import { describe, expect, it } from "vitest";
import {
  FLOW_MIX,
  LOAD_PROFILE,
  selectFlow,
  seededRandom,
  targetVus,
  type Flow,
} from "../../../scripts/evidence/profile.js";

describe("load profile (NFR7)", () => {
  it("matches the approved shape: 500 VUs, 2 min ramp, 8 min steady, 10 min total", () => {
    expect(LOAD_PROFILE).toEqual({
      virtualUsers: 500,
      rampSeconds: 120,
      steadySeconds: 480,
      totalSeconds: 600,
    });
    expect(LOAD_PROFILE.rampSeconds + LOAD_PROFILE.steadySeconds).toBe(LOAD_PROFILE.totalSeconds);
  });

  it("ramps linearly and holds the steady state until the end", () => {
    expect(targetVus(0)).toBe(0);
    expect(targetVus(60)).toBe(250);
    expect(targetVus(120)).toBe(500);
    expect(targetVus(300)).toBe(500);
    expect(targetVus(599.9)).toBe(500);
    expect(targetVus(600)).toBe(0);
    expect(targetVus(900)).toBe(0);
  });

  it("rejects negative and non-finite times", () => {
    expect(() => targetVus(-1)).toThrow(/non-negative/);
    expect(() => targetVus(Number.NaN)).toThrow(/finite/);
  });

  it("selects flows on the 70/20/10 boundaries", () => {
    expect(selectFlow(0)).toBe("read");
    expect(selectFlow(0.699)).toBe("read");
    expect(selectFlow(0.7)).toBe("rsvp");
    expect(selectFlow(0.899)).toBe("rsvp");
    expect(selectFlow(0.9)).toBe("other");
    expect(selectFlow(0.999)).toBe("other");
  });

  it("rejects rolls outside [0, 1)", () => {
    expect(() => selectFlow(1)).toThrow();
    expect(() => selectFlow(-0.1)).toThrow();
    expect(() => selectFlow(Number.NaN)).toThrow();
  });

  it("produces the approximate mix over a deterministic seeded sequence", () => {
    const random = seededRandom(32);
    const counts: Record<Flow, number> = { read: 0, rsvp: 0, other: 0 };
    const samples = 20000;
    for (let index = 0; index < samples; index++) {
      counts[selectFlow(random())] += 1;
    }
    for (const flow of ["read", "rsvp", "other"] as const) {
      expect(counts[flow] / samples).toBeCloseTo(FLOW_MIX[flow], 1);
    }
    const first = seededRandom(32);
    const second = seededRandom(32);
    expect(Array.from({ length: 5 }, () => first())).toEqual(
      Array.from({ length: 5 }, () => second()),
    );
  });
});
