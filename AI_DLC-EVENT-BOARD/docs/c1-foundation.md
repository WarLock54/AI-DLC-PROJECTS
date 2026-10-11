# C1 Foundation

## Boundaries

The single CDK application owns the shared DynamoDB table, Cognito User Pool
and app client, the exact `organizer` and `admin` groups, private S3 web/banner/
archive buckets, CloudFront OAC, the HTTP API, its public health Lambda, seed
runtime role, demo-credential secret, and C1-owned C-01 outputs. The health
route is the only route created by C1. The Cognito JWT authorizer is configured
for the approved issuer and audience; protected routes are attached by their
owning Units. C1 does not add event APIs, UI, queues, DLQs, schedules, alarms,
or monitoring filters.

The DynamoDB table preserves C-03's `pk`/`sk` primary keys and GSI1-GSI7,
on-demand billing, managed encryption, and point-in-time recovery. Seed fixtures
have stable C-03 key shapes, synthetic identities, deterministic event IDs, a
reminder-time event fixture, an older archive-eligibility fixture, and one
synthetic registration.

All C1-created CloudWatch log groups have explicit 14-day retention. S3 buckets
block public access and enforce TLS. CloudFront serves the web bucket through
OAC and forwards `/api/*` to API Gateway without caching.

## Output and ownership contract

C1 emits only its approved C-01 fields: `SiteUrl`, `ApiBaseUrl`, `UserPoolId`,
`UserPoolClientId`, `WebBucketName`, `DistributionId`, `BannerBucketName`,
`TableName`, `ArchiveBucketName`, `DemoCredentialsSecretArn`, and `Region`.
`SiteUrl` and `ApiBaseUrl` are the same CloudFront URL. `Region` reports
`AWS_DEFAULT_REGION`; final verification must assert `Region=us-east-1`.
Passwords are stored only in Secrets Manager; only the approved secret ARN is
output. Remaining C-01 fields belong to their approved provider Units and are
not stubbed or emitted by C1: `ArchiveFunctionName` names the U5 archival
function and is emitted by U5; `ReminderQueueUrl` and `AlarmTopicArn` name U6
queue and alarm resources and are emitted by U6.

Open I2 follow-up: the contract table and the C-06 owner note in the I2
contract summary, and the Bolt 1 expected demo in the delivery plan, still
assign `ArchiveFunctionName` to U1. They need correcting to U5; C1 does not
emit an output for a function it does not own.

R-01 is resolved: runtime region validation accepts only `us-east-1` through
`AWS_DEFAULT_REGION`, consistent with NFR4.1 and the project deployment rule.
This remains compatible with the effective C-01 v1 Region enum because
`us-east-1` is one of its values.

## Runtime and IAM boundaries

The stateless Node.js 22.x health Lambda has no data access. Its execution role
can write only to its explicit log group. The `team32-ceb-seed-runtime` role is
assumed only when the seed command runs; its permissions are limited to
`GetItem` and `PutItem` on the C1 table, read/write of the C1 credential secret, and
the Cognito user-management actions on the C1 User Pool. The caller needs an
explicit identity policy to assume this role. Deployment credentials are
provided through environment variables and must be separately scoped by the
deployment environment. The `FoundationStack` exposes its `httpApi` and
`cognitoJwtAuthorizer` constructs for later same-stack route owners; neither is
an additional CloudFormation output. C1 does not create an account-specific
deployment principal; deployment identities are managed by the deployment
environment/C2 pipeline, and CDK manages its bootstrap roles.

| Wildcard boundary                                                      | Owner | Justification                                                                                    | Review date |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------ | ----------- |
| Lambda log-stream suffix under the exact `team32-ceb-health` log group | Onur  | CloudWatch Logs requires stream-level writes; the policy is scoped to one log group.             | 2027-01-03  |
| CloudFront S3 object-key suffix under the private web bucket           | Onur  | CloudFront must read objects beneath the bucket through the OAC-constrained distribution policy. | 2027-01-03  |
| API Gateway log-stream suffix under the exact API access-log group     | Onur  | API Gateway writes access records to its configured log group.                                   | 2027-01-03  |

No wildcard action is granted to the seed runtime role.

## Non-destructive seed initialization

The loader validates the entire incoming fixture set before writing, then
initializes each record with `PutItem` conditioned on `attribute_not_exists(pk)`.
The condition applies to the exact composite `pk`/`sk` key; it is not a
partition-wide absence check. Repeat and concurrent runs never replace existing
records. On a condition failure, a strongly consistent `GetItem` must confirm
the same keys and fixture identity (`eventId`, and `entityType` or
`registrationId` where present). Missing or conflicting identity fails the run
without modifying the record. Existing content, indexes, counts, registration
status, and lifecycle remain application-owned and untouched.

Legacy repair allowlist: **none**. Missing identity is an explicit error, not
permission to repair or overwrite an older record.

Only the current failed operation is retried for recognized throttling,
transient service errors, or ambiguous timeout/connection failures: at most
six application attempts, with delays of 25, 50, 100, 200, and 400 ms. AWS SDK
transport retries may occur within an application attempt. Permanent errors,
read failures, and retry exhaustion propagate to the seed CLI's nonzero exit.
If an ambiguous write committed, its conditional retry preserves that record
and validates identity. Earlier successful records are not rolled back or
replayed within the run; rerunning after partial failure safely preserves them
and initializes remaining absent keys. The returned item count means fixtures
created or validated as preserved, not newly inserted records.

IAM grants only table-scoped `GetItem`/`PutItem` for this strategy; conditions
are enforced by the loader. No update, delete, scan, query, or batch-write
permission is needed. This permission replacement introduces no wildcard and
does not change the secret or Cognito permissions.

This is DynamoDB Event/Registration initialization, not S3 archive-object
handling. Marker-aware suppression, marker retention/removal guarantees,
tombstones, purging, ID reuse, and C3/C5 archive migration are excluded. Absent
keys can be initialized again; no no-resurrection guarantee is claimed.

## CDK Nag exceptions

The stack runs `AwsSolutionsChecks`. The following scoped suppressions document
controls that cannot be met without exceeding the approved C1 boundary or
altering explicit C-02/runtime decisions. Each is owned by Onur and must be
reviewed by 2027-01-03:

| Rule                 | Resource               | Justification                                                                                                          |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AwsSolutions-COG2`  | Cognito User Pool      | Synthetic demo identities need deterministic non-MFA verification; reassess for production onboarding.                 |
| `AwsSolutions-COG3`  | Cognito User Pool      | Advanced threat-protection cost and requirements are not established for this synthetic MVP identity slice.            |
| `AwsSolutions-S1`    | S3 buckets             | S3 access logging would retain requester metadata; API logs cover the approved operational request fields.             |
| `AwsSolutions-SMG4`  | Demo credential secret | Independent rotation would desynchronize Cognito passwords; coordinated rotation needs a separately designed workflow. |
| `AwsSolutions-L1`    | Health Lambda          | Node.js 22.x is explicitly required; review before AWS deprecation.                                                    |
| `AwsSolutions-CFR1`  | CloudFront             | No country restriction is approved for a public event board.                                                           |
| `AwsSolutions-CFR2`  | CloudFront             | WAF is outside C1 scope and adds ongoing cost; add only with an approved security requirement.                         |
| `AwsSolutions-CFR3`  | CloudFront             | Viewer logs include requester metadata; API access logs provide the C1-required fields without cookies.                |
| `AwsSolutions-CFR4`  | CloudFront             | C-01 supplies the default CloudFront hostname and no custom domain/certificate; HTTPS redirection is enabled.          |
| `AwsSolutions-APIG4` | `GET /api/health`      | C-02 explicitly defines health as public and its response contains only service status.                                |

These exceptions are not evidence of a deployed security assessment. High or
Critical findings remain release blockers unless their required waiver is
recorded by the security owner.

## Dependency audit waiver

| Package and advisories                                                                                                                | Owner | Justification                                                                                                                                                                                                                        | Compensating controls                                                                                                                                                                                                                                                                       | Expiry/review date |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Bundled `brace-expansion@5.0.9` within `aws-cdk-lib@2.272.0`; `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, and `GHSA-6j4f-fj2g-mc7p` | Onur  | The newest published `aws-cdk-lib` release checked on 2026-10-03 is still `2.272.0` and bundles this vulnerable version. `aws-cdk-lib` is used at synthesis/build time and is not bundled into the Node.js Lambda runtime artifacts. | Keep the CDK version and lockfile pinned; run `npm run security-audit` in validation. That gate accepts only these advisory IDs at the exact bundled package path and version, and fails for new or other High/Critical findings. Upgrade promptly when a patched CDK release is available. | 2027-01-03         |

The `npm run security-audit` waiver is time-bounded and must be reassessed by
its review date. It does not waive unrelated dependency findings or Critical
findings.

The prohibited-content check enumerates tracked paths with `git ls-files`, then
applies `scripts/prohibited-token-policy.ts`: it scans `src/`, `scripts/`,
`test/`, `docs/`, root Markdown documentation, and selected root configuration
files for the configured case-insensitive substring. Generated, dependency,
and build output is excluded. Untracked local files are never scanned.

## Teardown hand-off for C2/C7

These C1 resources use `RemovalPolicy.RETAIN`, so `cdk destroy` leaves them in
place: the API access and health log groups, the Cognito User Pool, the
DynamoDB table, the web/banner/archive S3 buckets, and the demo-credential
secret (`src/infrastructure/foundation-stack.ts`). The explicitly triggered
`TEARDOWN=true` job must delete them (emptying the versioned buckets first)
before the NFR30 cleanup proof can show that no `project=team32-ceb` resources
remain. The final verification deployment is never torn down. The pipeline must
run `npm run synth` (CDK synthesis with AwsSolutions `cdk-nag`) and
`npm run prohibited-token-check`.

## Environment variables

Set names only as shown below; never place their values in source or logs.

| Variable                | Purpose                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_DEFAULT_REGION`    | Sole region input; must be `us-east-1`.                                                                                                                                             |
| `AWS_ACCESS_KEY_ID`     | Deployment/seed caller credential.                                                                                                                                                  |
| `AWS_SECRET_ACCESS_KEY` | Deployment/seed caller credential.                                                                                                                                                  |
| `AWS_SESSION_TOKEN`     | Optional temporary-credential component for an explicitly authorized debug sandbox.                                                                                                 |
| `C1_STACK_NAME`         | Optional stack selector; defaults to `team32-ceb-foundation`.                                                                                                                       |
| `SEED_REFERENCE_TIME`   | Optional canonical UTC seed anchor override; otherwise the stack `CreationTime` is used. On older stacks where `CreationTime + 24h` is already past, set this explicitly per FR7.3. |

`AWS_PROFILE` and `AWS_DEFAULT_PROFILE` are rejected. Deployment and seed
commands do not fall back to local AWS profiles.

## Build and verification commands

Install with `npm ci` on Node.js 22.x. C1-scoped commands are:

```text
npm run test:c1-foundation
npm run test:c1-foundation:integration
npm run validate
npm run synth
npm run prohibited-token-check
npm run security-audit
```

`validate` runs, in order: the TypeScript build (`tsc --noEmit`), ESLint,
Prettier `--check`, the C1 unit tests with coverage, the C1 integration tests
(CDK assertions and the `cdk-nag` test), `npm run security-audit`, and
`npm run prohibited-token-check`. None of these needs AWS credentials. Unit
coverage includes only C1 Lambda and seed code and enforces an 80% line floor.
`cdk-nag` AwsSolutions checks run in two places: `npm run synth` applies them
during CDK synthesis, and `test/c1-foundation/integration/cdk-nag.test.ts`
applies them in `validate` and fails on any unsuppressed error. IaC quality is
verified by synthesis, CDK assertions, and `cdk-nag`, not by IaC line coverage.

Pipeline-callable commands are `npm run deploy`, `npm run health-check`, and
`npm run seed`. `deploy` requires environment credentials, bootstraps the
current account/region through those credentials, deploys the C1 stack, and
validates the C1 output names and CloudFront URL relationship. `health-check`
reads the deployment output file and requires HTTPS HTTP 200 with
`{"status":"ok"}`. `seed` reads the approved table, user-pool, and secret ARN
outputs; assumes the scoped seed runtime role; and does not print or persist
password values outside Secrets Manager.

## Debug-sandbox smoke procedure

Onur supplied the following human-run evidence on 2026-10-04 from commit
`aceaf80`, using `us-east-1`:

- `npm run deploy` created the CDK bootstrap and the
  `team32-ceb-foundation` stack.
- A second `npm run deploy` reported no changes.
- The deployment script reported C1 foundation deployment and output contract
  verification succeeded; all approved output names were present:
  `ApiBaseUrl`, `ArchiveBucketName`, `BannerBucketName`,
  `DemoCredentialsSecretArn`, `DistributionId`, `Region`, `SiteUrl`,
  `TableName`, `UserPoolClientId`, `UserPoolId`, and `WebBucketName`.
- `npm run health-check` succeeded against the HTTPS CloudFront endpoint.
- `npm run seed` completed with `itemCount 3` and `demoUserCount 2`.
- A second `npm run seed` produced the same result without errors, consistent
  with create-only rerun behavior.

This evidence was captured at commit `aceaf80`. The R-04 seed anchor (stack
`CreationTime` by default, validated `SEED_REFERENCE_TIME` override, error on a
missing anchor) landed later in commit `6495616` and is covered by unit tests in
`test/c1-foundation/unit/seed.test.ts`, not by a newer sandbox run.

No account IDs, ARNs, URLs, keys, or e-mail addresses are recorded here.
Teardown remains separate and explicitly triggered; it is not part of the
final verification deployment.

### Repeatable debug-sandbox smoke procedure

Once authorized, supply credentials through the approved environment/CI secret
store, then run:

```text
npm run deploy
npm run health-check
npm run seed
```

The deployment command writes `cdk-outputs.json` locally; it is ignored by Git.
Review the C1 output contract and health response without exposing secret
values. Teardown is not part of these commands and must remain a separate,
explicitly triggered debug-sandbox action. Never tear down the final
verification deployment.

## Safe demo-user recovery and organizer identity

The demo-user seed flow reuses stored credentials when they are valid. Missing
or policy-invalid legacy values are replaced by passwords from the
policy-safe generator, and the replacement credentials are persisted to the
secret before any Cognito user mutation. Secret or Cognito failures stop the
seed rather than being suppressed (`src/seed/demo-users.ts`,
`src/seed/aws-adapter.ts`).

The CLI seeds the demo users first, receives the organizer's Cognito subject,
validates that it is a valid subject, and passes it into fixture creation.
Fixtures use that value for `organizerSubject` and the organizer index
(`src/seed/cli.ts`, `src/seed/demo-users.ts`, `src/seed/fixtures.ts`).
