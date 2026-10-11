import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  evaluateIf,
  jobNames,
  resolveJob,
  selectJobs,
  type JobDefinition,
  type PipelineDefinition,
} from "./gitlab-rules.js";

const repositoryFile = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const pipelineText = repositoryFile(".gitlab-ci.yml");
const pipeline = parse(pipelineText) as PipelineDefinition;

const VALIDATE_JOBS = [
  "lint",
  "test",
  "synth",
  "dependency-audit",
  "secret-scan",
  "prohibited-token-check",
];
const DEPLOY_PATH_JOBS = ["deploy", "health-check"];

const CONTEXTS = {
  pushMain: { CI_PIPELINE_SOURCE: "push", CI_COMMIT_BRANCH: "main" },
  pushMainWithTeardown: { CI_PIPELINE_SOURCE: "push", CI_COMMIT_BRANCH: "main", TEARDOWN: "true" },
  mergeRequest: {
    CI_PIPELINE_SOURCE: "merge_request_event",
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
  },
  webMainTeardown: { CI_PIPELINE_SOURCE: "web", CI_COMMIT_BRANCH: "main", TEARDOWN: "true" },
  apiMainTeardown: { CI_PIPELINE_SOURCE: "api", CI_COMMIT_BRANCH: "main", TEARDOWN: "true" },
  webMain: { CI_PIPELINE_SOURCE: "web", CI_COMMIT_BRANCH: "main" },
  pushFeature: { CI_PIPELINE_SOURCE: "push", CI_COMMIT_BRANCH: "4-c2-feature" },
  scheduleMain: { CI_PIPELINE_SOURCE: "schedule", CI_COMMIT_BRANCH: "main" },
} as const;

function job(name: string): JobDefinition {
  return resolveJob(pipeline, name);
}

function scriptOf(name: string): string {
  return (job(name).script ?? []).join("\n");
}

function imageName(image: JobDefinition["image"]): string | undefined {
  return typeof image === "string" ? image : image?.name;
}

describe(".gitlab-ci.yml job selection", () => {
  it.each([
    ["push to main", CONTEXTS.pushMain],
    ["push to main with a leftover TEARDOWN=true", CONTEXTS.pushMainWithTeardown],
  ])("%s runs every validate job, then deploy and health-check, never teardown", (_, context) => {
    expect(selectJobs(pipeline, context)).toEqual([...VALIDATE_JOBS, ...DEPLOY_PATH_JOBS]);
  });

  it("runs only the validate jobs for a merge request", () => {
    expect(selectJobs(pipeline, CONTEXTS.mergeRequest)).toEqual(VALIDATE_JOBS);
  });

  it.each([
    ["web", CONTEXTS.webMainTeardown],
    ["api", CONTEXTS.apiMainTeardown],
  ])("runs only teardown for a %s pipeline on main with TEARDOWN=true", (_, context) => {
    expect(selectJobs(pipeline, context)).toEqual(["teardown"]);
  });

  it("deploys normally for a manual run on main without TEARDOWN", () => {
    expect(selectJobs(pipeline, CONTEXTS.webMain)).toEqual([...VALIDATE_JOBS, ...DEPLOY_PATH_JOBS]);
  });

  it.each([
    ["push to a feature branch", CONTEXTS.pushFeature],
    ["schedule on main", CONTEXTS.scheduleMain],
  ])("creates no pipeline for a %s", (_, context) => {
    expect(selectJobs(pipeline, context)).toEqual([]);
  });
});

describe(".gitlab-ci.yml structure", () => {
  it("orders the stages validate, deploy, health-check, teardown and chains needs", () => {
    expect(pipeline.stages).toEqual(["validate", "deploy", "health-check", "teardown"]);
    for (const name of VALIDATE_JOBS) {
      expect(job(name).stage).toBe("validate");
    }
    expect(job("deploy").stage).toBe("deploy");
    expect(job("health-check").stage).toBe("health-check");
    expect(job("teardown").stage).toBe("teardown");
    expect([...(job("deploy").needs ?? [])].sort()).toEqual([...VALIDATE_JOBS].sort());
    expect(job("health-check").needs).toEqual([{ job: "deploy", artifacts: true }]);
    expect(job("deploy").artifacts).toMatchObject({ paths: ["cdk-outputs.json"] });
  });

  it("includes every NFR23 quality gate in the validate jobs", () => {
    const validateScripts = VALIDATE_JOBS.map(scriptOf).join("\n");
    for (const command of [
      "npm run build",
      "npm run lint", // ESLint
      "npm run format:check", // Prettier
      "npm run test:c1-foundation", // unit tests with coverage
      "npm run test:c1-foundation:integration", // CDK assertions and cdk-nag
      "npm run test:c2-ci-cd",
      "npm run test:c6-async-monitoring", // C6 CDK assertions and cdk-nag
      "npm run test:c5-reminders-statistics-archival", // C5 unit tests with coverage
      "npm run test:c5-reminders-statistics-archival:integration", // C5 CDK assertions and cdk-nag
      "npm run test:c3-event-apis", // C3 unit tests with coverage, incl. RSVP concurrency (NFR26)
      "npm run test:c3-event-apis:integration", // C3 CDK assertions and cdk-nag
      "npm run test:c4-ui", // C4 unit tests with coverage
      "npm run test:c4-ui:integration", // C4 CDK assertions and cdk-nag
      "npm run synth", // cdk synth with AwsSolutions cdk-nag
      "npm run security-audit", // npm audit with High/Critical blocking
      "gitleaks git --redact", // secret scanning without printing values
      "npm run prohibited-token-check", // case-insensitive prohibited-token check
    ]) {
      expect(validateScripts).toContain(command);
    }
    expect(job("secret-scan").variables).toMatchObject({ GIT_DEPTH: "0" });
    // The test script exists and enforces coverage.
    const packageJson = JSON.parse(repositoryFile("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["test:c1-foundation"]).toContain("--coverage");
    expect(packageJson.scripts["test:c2-ci-cd"]).toContain("--coverage");
    expect(packageJson.scripts["test:c6-async-monitoring"]).toContain("--coverage");
    expect(packageJson.scripts["test:c5-reminders-statistics-archival"]).toContain("--coverage");
    expect(packageJson.scripts["test:c3-event-apis"]).toContain("--coverage");
    expect(packageJson.scripts["test:c4-ui"]).toContain("--coverage");
    // The test job reports a coverage percentage on the merge request.
    expect(repositoryFile(".gitlab-ci.yml")).toMatch(/^ {2}coverage: '\/Lines/m);
  });

  it("never gates or softens the deploy path", () => {
    for (const name of jobNames(pipeline)) {
      expect(job(name).when, name).not.toBe("manual");
      for (const rule of job(name).rules ?? []) {
        expect(rule.when, name).not.toBe("manual");
      }
    }
    for (const name of [...VALIDATE_JOBS, ...DEPLOY_PATH_JOBS]) {
      expect(job(name).allow_failure, name).toBeUndefined();
    }
  });

  it("keeps destructive commands in the teardown job only", () => {
    const destructive = /cdk\s+destroy|delete-stack|run teardown|scripts\/teardown/;
    for (const name of jobNames(pipeline)) {
      if (name === "teardown") {
        expect(scriptOf(name)).toMatch(destructive);
      } else {
        expect(scriptOf(name), name).not.toMatch(destructive);
      }
    }
    expect(pipelineText).not.toMatch(/cdk\s+destroy|delete-stack/);
  });

  it("references only the three approved AWS variables and never dumps the environment", () => {
    const awsVariables = new Set(pipelineText.match(/AWS_[A-Z_]+/g) ?? []);
    expect([...awsVariables].sort()).toEqual([
      "AWS_ACCESS_KEY_ID",
      "AWS_DEFAULT_REGION",
      "AWS_SECRET_ACCESS_KEY",
    ]);
    expect(pipelineText).not.toMatch(/AWS_SESSION_TOKEN|AWS_PROFILE|--profile/);
    const allScripts = jobNames(pipeline).map(scriptOf).join("\n");
    expect(allScripts).not.toMatch(/set -x|^\s*(env|printenv|export)\b/m);
    // Only the synth job sets a region in YAML, as a merge-request fallback.
    const regionSetters = jobNames(pipeline).filter(
      (name) => (job(name).variables as Record<string, string> | undefined)?.AWS_DEFAULT_REGION,
    );
    expect(regionSetters).toEqual(["synth"]);
    expect(job("synth").variables).toMatchObject({ AWS_DEFAULT_REGION: "us-east-1" });
  });

  it("pins every image to an exact version tag", () => {
    const images = [
      imageName(pipeline.default?.image),
      ...jobNames(pipeline).map((name) => imageName(job(name).image)),
    ].filter((image): image is string => image !== undefined);
    expect(images).toContain("node:22.23.3-bookworm");
    expect(images).toContain("zricethezav/gitleaks:v8.30.1");
    for (const image of images) {
      expect(image).toMatch(/:v?\d+\.\d+\.\d+(-[a-z0-9]+)?$/);
      expect(image).not.toMatch(/:latest$/);
    }
  });

  it("deploys with bootstrap before deploy, then seeds, and bounds the health-check retries", () => {
    // C5 (C-06): the post-deploy archival invocation runs after the seed.
    expect(job("deploy").script).toEqual([
      "npm run deploy",
      "npm run seed",
      "npx tsx scripts/ci/retry-cli.ts --attempts 3 --delay-seconds 20 -- npm run archive-invoke",
    ]);
    expect(job("deploy").resource_group).toBe("team32-ceb-deploy");
    const deployScript = repositoryFile("scripts/deploy.ts");
    const bootstrapAt = deployScript.indexOf('runCdk(["bootstrap"');
    const deployCall = /runCdk\(\s*\[\s*"deploy",[^\]]*"--require-approval",\s*"never"/.exec(
      deployScript,
    );
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(deployCall).not.toBeNull();
    expect(deployCall?.index ?? -1).toBeGreaterThan(bootstrapAt);
    // Both CDK stacks are deployed; CDK orders them by their cross-stack dependency.
    expect(deployScript).toContain('"team32-ceb-foundation"');
    expect(deployScript).toContain('"team32-ceb-async-monitoring"');

    const health = scriptOf("health-check");
    const match = health.match(
      /scripts\/ci\/retry-cli\.ts --attempts (\d+) --delay-seconds (\d+) -- npm run health-check/,
    );
    expect(match).not.toBeNull();
    const [attempts, delaySeconds] = [Number(match?.[1]), Number(match?.[2])];
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts * delaySeconds).toBeLessThanOrEqual(600);
    // C5 (FR8.5): the statistics smoke test runs after the health check.
    expect(health.indexOf("npm run stats-check")).toBeGreaterThan(
      health.indexOf("npm run health-check"),
    );
  });
});

describe("gitlab-rules helper", () => {
  it("evaluates comparisons, precedence, parentheses, and unset variables", () => {
    const variables = { A: "1", B: "2" };
    expect(evaluateIf('$A == "1" && $B == "2"', variables)).toBe(true);
    expect(evaluateIf('$A == "2" || $B == "2"', variables)).toBe(true);
    expect(evaluateIf('$A == "2" || $B == "2" && $A == "2"', variables)).toBe(false);
    expect(evaluateIf('($A == "2" || $B == "2") && $A == "1"', variables)).toBe(true);
    expect(evaluateIf('$MISSING == "true"', variables)).toBe(false);
    expect(evaluateIf('$MISSING != "true"', variables)).toBe(true);
    expect(evaluateIf("$A", variables)).toBe(true);
    expect(evaluateIf("$MISSING", variables)).toBe(false);
  });

  it("rejects syntax outside the supported subset", () => {
    expect(() => evaluateIf("$A =~ /main/", {})).toThrow(/Unsupported/);
    expect(() => evaluateIf('($A == "1"', {})).toThrow(/Missing '\)'/);
    expect(() => evaluateIf('$A == "1" "2"', {})).toThrow(/trailing/);
  });
});
