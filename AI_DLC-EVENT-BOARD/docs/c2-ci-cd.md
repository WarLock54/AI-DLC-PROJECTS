# C2 CI/CD Pipeline

The `.gitlab-ci.yml` pipeline for the single CDK app runs
`validate -> deploy -> health-check` on pushes to `main` and exits 0 only after
the deployed application answers its health check. A separate, explicitly
triggered `teardown` job removes everything from a debug sandbox.

## Pipelines at a Glance

| Trigger | Jobs that run |
|---|---|
| Push to `main` | All validate jobs, then `deploy`, then `health-check` |
| Merge request | Validate jobs only (no AWS credentials needed, no deploy) |
| Run pipeline on `main` (web or API), no `TEARDOWN` | Same as a push to `main` |
| Run pipeline on `main` (web or API) with `TEARDOWN=true` | `teardown` only |
| Anything else (other branches, schedules) | No pipeline |

A push to `main` ignores `TEARDOWN` completely, so a commit can never trigger
cleanup or skip the deploy.

## Stages and Gates

| Stage | Job | What it proves |
|---|---|---|
| validate | `lint` | TypeScript compiles (`npm run build`), ESLint, Prettier check |
| validate | `test` | C1 unit tests with an 80% line-coverage floor, C1 CDK assertion and `cdk-nag` tests, C2 tests with an 80% line-coverage floor; coverage kept as a job artifact |
| validate | `synth` | `cdk synth` with the AwsSolutions `cdk-nag` aspect; error findings fail synthesis |
| validate | `dependency-audit` | `npm audit`; High/Critical findings block unless a documented waiver (owner, justification, expiry) applies |
| validate | `secret-scan` | `gitleaks` over the full Git history with `--redact`; any finding fails the job |
| validate | `prohibited-token-check` | Case-insensitive prohibited-token check over in-scope authored files |
| deploy | `deploy` | `npm run deploy` (idempotent `cdk bootstrap`, then `cdk deploy --require-approval never`, then the C-01 output check), then `npm run seed` (idempotent deterministic seed data) |
| health-check | `health-check` | `npm run health-check` through a retry wrapper: up to 10 attempts, 30 seconds apart; fails unless HTTPS `/api/health` returns 200 `{"status":"ok"}` |
| teardown | `teardown` | Debug-sandbox cleanup and inventory proof (see below) |

`deploy` needs every validate job. It has no `when: manual` and no
`allow_failure`, so the pipeline fails if any gate, the deployment, or the
health check fails. `deploy` and `teardown` share the `team32-ceb-deploy`
resource group, so two pipelines never change the stack at the same time.

The normal `main` pipeline never destroys resources. Teardown is a separate,
explicit operation.

## Required CI/CD Variables

Set these under **Settings > CI/CD > Variables**, masked, and protected for
`main`:

| Variable | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | Deployment access key |
| `AWS_SECRET_ACCESS_KEY` | Deployment secret key |
| `AWS_DEFAULT_REGION` | Target region; defaults to `us-east-1` for synthesis |

The pipeline uses no other AWS variable, no AWS profile, and no account-specific
value. Nothing in the pipeline prints credentials or dumps the environment.

The `synth` job sets `AWS_DEFAULT_REGION: us-east-1` in YAML only as a fallback
for merge request pipelines, where protected variables are not available. A
project variable with the same name takes precedence.

### Optional session token

Temporary credentials may require `AWS_SESSION_TOKEN`. Store it only as a
masked CI variable when needed and remove it when the credentials are rotated.
The pipeline does not set this variable itself; the AWS SDK reads it when
present.

### Never store TEARDOWN as a project variable

`TEARDOWN` must only be typed into the **Run pipeline** form for one run. A
manual or API pipeline on `main` treats `TEARDOWN=true` as a cleanup request and
skips the deploy, so a leftover project-level `TEARDOWN` variable would turn
every such run into a cleanup.

## Running Teardown

1. Open **Build > Pipelines > Run pipeline**.
2. Choose branch `main`.
3. Add variable `TEARDOWN` with value `true`.
4. Run the pipeline. Only the `teardown` job runs.

`npm run teardown` (`scripts/teardown/cli.ts`) refuses to run unless
`TEARDOWN=true` is set, uses environment credentials only, and then:

1. Deletes every CloudFormation stack whose name starts with `team32-ceb-` and
   waits for each deletion. `CDKToolkit` and unrelated stacks are kept.
2. Deletes the resources that survive stack deletion because of
   `RemovalPolicy.RETAIN`, found by the tag `project=team32-ceb`: S3 buckets
   (all object versions and delete markers removed first), CloudWatch log
   groups, the Cognito user pool, the DynamoDB table, and the Secrets Manager
   secret (force-deleted, no recovery window).
3. Proves the inventory: no `team32-ceb-` stacks and no resources tagged
   `project=team32-ceb`. It re-checks for up to about five minutes because the
   tag index is eventually consistent, and exits non-zero if anything remains.

Unknown tagged resource types are never deleted by guesswork; they are reported
and fail the inventory check until they are gone. Output names resource types
and names only; ARNs and account IDs are redacted.

The command prints an inventory report; retain it with the deployment records
if cleanup evidence is required.

## Adding Post-Deploy Jobs in Later Units

Post-deploy jobs (including archival invocation and the statistics smoke test)
run after `deploy`. Use the `.deploy-path` rule template
and `needs: [{ job: deploy, artifacts: true }]` so the job reads
`cdk-outputs.json` and never runs on merge requests or in a teardown pipeline.
Do not add `when: manual` or `allow_failure` to any deploy-path job. A new stack
whose name starts with `team32-ceb-` is removed by teardown automatically.

## Local Equivalents

```bash
npm ci
npm run build && npm run lint && npm run format:check
npm run test:c1-foundation && npm run test:c1-foundation:integration && npm run test:c2-ci-cd
AWS_DEFAULT_REGION=us-east-1 npm run synth
npm run security-audit
npm run prohibited-token-check
```

Deployment, health check, and teardown need sandbox credentials in the
environment and normally run only in the pipeline.
