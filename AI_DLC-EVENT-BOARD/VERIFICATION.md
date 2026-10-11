# Verification

The current project owner and maintainer is Onur. This document describes how to verify the current codebase; it does not change or rewrite historical AI-DLC audit attribution.

## Local checks

Run from the repository root:

```powershell
npm ci
npm run validate
$env:AWS_DEFAULT_REGION = "us-east-1"
npm run synth
```

`npm run validate` covers compilation, linting, formatting, the configured unit and integration suites, evidence-manifest validation, dependency/security checks, and prohibited-content checks. `npm run synth` synthesizes the CDK application; it does not deploy it.

## Deployment verification

1. Confirm the target AWS account and region before deployment.
2. Open a merge request and confirm the validation jobs pass. Merge-request pipelines do not deploy.
3. After merging to `main`, confirm the pipeline deploy, seed, archival, HTTPS health-check, UI, and statistics jobs all pass.
4. Review the generated evidence and operational documents under `docs/` for consistency with the deployed application.
5. Run teardown only when intentionally removing the target environment; use the explicit `TEARDOWN=true` path described in [AUTO-DEPLOY.md](AUTO-DEPLOY.md).

## AI-DLC verification

Run `/aidlc --doctor` in GitHub Copilot to check the workflow installation. Keep the AI-DLC shell and method imports intact. The active project rules live under `aidlc/spaces/default/memory/`; stage records and audit history live under `aidlc/spaces/default/intents/`.

When preparing a personal repository, retain an unchanged private backup of any historical team intent before excluding it from the shared copy. Do not rewrite audit events to change who performed past work. A new solo intent can document current ownership and future work separately.
