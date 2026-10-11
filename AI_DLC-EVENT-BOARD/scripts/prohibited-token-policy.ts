import { extname } from "node:path";

const SCAN_DIRECTORIES = new Set(["src", "scripts", "test", "docs", "ui"]);
const SCAN_FILES = new Set([
  "package.json",
  "cdk.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "vitest.config.ts",
  ".prettierrc.json",
]);
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cfg",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".tf",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
// Generated, dependency, and AI-DLC record folders are skipped at any depth.
const EXCLUDED_DIRECTORIES = new Set(["aidlc", "node_modules", "cdk.out", "coverage", "dist"]);
// The root project documentation is authored and maintained with the source;
// scan it alongside the selected root configuration files.
const ROOT_MARKDOWN_EXTENSIONS = new Set([".md"]);
const PROHIBITED_TOKEN = ["ep", "am"].join("");

/** True when a tracked repo-relative path is in the prohibited-token scan scope. */
export function isCandidate(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/");
  const [first] = segments;
  const extension = extname(segments[segments.length - 1]).toLowerCase();
  const inScope =
    (segments.length > 1 && SCAN_DIRECTORIES.has(first)) ||
    (segments.length === 1 && (SCAN_FILES.has(first) || ROOT_MARKDOWN_EXTENSIONS.has(extension)));
  return (
    inScope &&
    !segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment)) &&
    TEXT_EXTENSIONS.has(extension)
  );
}

/** 1-based line numbers containing the prohibited token as a substring in any casing. */
export function findProhibited(contents: string): number[] {
  return contents
    .split(/\r?\n/)
    .flatMap((line, index) => (line.toLowerCase().includes(PROHIBITED_TOKEN) ? [index + 1] : []));
}
