import { describe, expect, it } from "vitest";
import { findProhibited, isCandidate } from "../../../scripts/prohibited-token-policy.js";

// Built from fragments so this file never contains the token it tests.
const TOKEN = ["e", "p", "a", "m"].join("");
const MIXED_CASE = ["E", "p", "A", "m"].join("");

describe("prohibited-token policy", () => {
  it("finds the token as a substring with a leading underscore", () => {
    expect(findProhibited(`const value = "_${TOKEN}";`)).toEqual([1]);
  });

  it("finds the token as a word prefix", () => {
    expect(findProhibited(`${TOKEN}foo`)).toEqual([1]);
  });

  it("finds the token in any casing", () => {
    expect(findProhibited(MIXED_CASE)).toEqual([1]);
    expect(findProhibited(TOKEN.toUpperCase())).toEqual([1]);
  });

  it("reports every matching 1-based line number across LF and CRLF endings", () => {
    const contents = ["clean", `has ${TOKEN}`, "clean", `again ${MIXED_CASE}`].join("\r\n");
    expect(findProhibited(contents)).toEqual([2, 4]);
    expect(findProhibited(["clean", "", `x${TOKEN}`].join("\n"))).toEqual([3]);
  });

  it("returns no findings for clean content", () => {
    expect(findProhibited("team32-ceb community event board")).toEqual([]);
    expect(findProhibited("")).toEqual([]);
  });

  it("scans nested files that share a course-provided file name", () => {
    expect(isCandidate("docs/README.md")).toBe(true);
    expect(isCandidate("docs/SETUP.md")).toBe(true);
    expect(isCandidate("src/infrastructure/foundation-stack.ts")).toBe(true);
    expect(isCandidate("package.json")).toBe(true);
  });

  it("scans root project documentation and keeps authored paths in scope", () => {
    expect(isCandidate("README.md")).toBe(true);
    expect(isCandidate("AUTO-DEPLOY.md")).toBe(true);
    expect(isCandidate("docs/README.md")).toBe(true);
    expect(isCandidate("src/x.ts")).toBe(true);
  });

  it("excludes generated, dependency, record, and non-text paths", () => {
    expect(isCandidate("docs/aidlc/notes.md")).toBe(false);
    expect(isCandidate("test/node_modules/pkg/index.js")).toBe(false);
    expect(isCandidate("src/cdk.out/manifest.json")).toBe(false);
    expect(isCandidate("docs/diagram.png")).toBe(false);
    expect(isCandidate("other/file.ts")).toBe(false);
  });

  it("normalizes Windows path separators", () => {
    expect(isCandidate("docs\\README.md")).toBe(true);
    expect(isCandidate("AUTO-DEPLOY.md")).toBe(true);
  });
});
