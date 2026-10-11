# C5 Reminders, Statistics, and Archival

C5 (unit U5) adds four Node.js 22.x Lambda functions and their business logic:
scheduled reminders, admin-only statistics, and archival of events older than
one year. It also adds a post-deploy archival step and a statistics smoke test
to the pipeline. Onur is the current project maintainer.

Contract basis: the approved **v1** contracts in `docs/contracts.md` (C-02,
C-03, C-05, C-06, C-07). The unapproved Group A write-once (v2) archive
proposal is **not** implemented (Q2). The reminder and statistics behavior below
is the **working C5 decision** for the still-open contract Groups B and C (Q3,
Q4); see [Contract reconciliation](#contract-reconciliation).

## Layout

| Layer                     | Location                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Shared rules              | `src/operations/shared/` (canonical time, C-03 keys, pagination, JSON logger)            |
| Reminders                 | `src/operations/reminders/` (C-05 message, repository, queue and email ports, selector, worker) |
| Statistics                | `src/operations/statistics/` (repository, service)                                       |
| Archival                  | `src/operations/archival/` (C-07 object, repository, S3 store, service)                  |
| Lambda entry points       | `src/lambda/admin-stats/`, `src/lambda/archival/`, `src/lambda/reminder-selector/`, `src/lambda/reminder-worker/` |
| Foundation-stack IaC      | `src/infrastructure/reminders-statistics-archival.ts` (`StatisticsAndArchival`)           |
| Async-monitoring IaC      | `src/infrastructure/async-monitoring/reminder-functions.ts` (`ReminderFunctions`)         |
| Shared function pattern   | `src/infrastructure/operations-function.ts`                                              |
| Pipeline scripts          | `scripts/archive-invoke.ts`, `scripts/stats-check.ts`, `scripts/c5/`                     |
| Statistics oracle         | `docs/expected-stats.json`                                                               |

C5 reuses the C3 key helpers, HTTP helpers (`createRouter`, `json`, the
`{code, message, field}` errors), and access policy unchanged. It does not
change C3 RSVP or event logic, the C1 seed loader, or the C4 UI.

## Decisions (Q1-Q5, all option A)

| #   | Decision                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Statistics, archival, the daily archival schedule, and the `ArchiveFunctionName` output live in the foundation stack. The reminder selector and worker live in the async-monitoring stack beside the queue and reach the table by its fixed name `team32-ceb-events`, so there is no cross-stack export. |
| Q2  | Archival follows C-06/C-07 v1 exactly: freeze, write `archive/{eventId}.json` (overwritten on reruns), delete registrations, then marker + META removal in one transaction.                                                                                     |
| Q3  | Reminder window `[now+23h, now+25h)` (widened from the original `[now+23h45m, now+24h15m)` after review finding R-01; see "Reminder timing for the seeded event"), one ReminderAttempt per `(eventId, registrationId)`, C-05 message, state re-check in the worker, `EMAIL_MODE=log` by default, SQS retry then DLQ.                                                                   |
| Q4  | `totalRsvps` and `popularCategories` must match the seed values exactly; view counts are checked as integers at or above a lower bound.                                                                                                                         |
| Q5  | C5 includes the archival invocation script, the statistics check script, the `.gitlab-ci.yml` steps, and the C5 suites in `validate`.                                                                                                                          |

## Reminders (FR7)

**Selector** (`team32-ceb-reminder-selector`, every 15 minutes through the C6
`team32-ceb-reminder-selection` schedule):

1. Query GSI7 `LIFECYCLE#active` for `startsAt` in `[now+23h, now+25h)`.
   Cancelled, deleted, archived, and rescheduled events are outside this
   partition or range.
2. For each event, query GSI5 `REGISTRATION#EVENT#{id}#STATUS#confirmed`.
3. For each registration, put the ReminderAttempt
   `REMINDER#{eventId}` / `REG#{registrationId}` (`gsi6pk`/`gsi6sk` per C-03,
   `outcome=queued`, `scheduledFor = startsAt - 24h`) only if it does not exist.
   An existing attempt is a duplicate and is skipped, so the two runs that see
   each event never send twice.
4. Send `{eventId, registrationId, scheduledFor}` (C-05, nothing else). If the
   send fails, the attempt is deleted and the error is rethrown, so the
   scheduler retry or the next run can recreate it.

**Worker** (`team32-ceb-reminder-worker`, SQS event source, batch size 10,
`ReportBatchItemFailures`):

- Validates the C-05 message strictly (exactly three fields). An invalid message
  is reported as a batch item failure and reaches the DLQ after the C6 redrive
  limit.
- Re-reads the attempt (an outcome other than `queued` is never delivered
  twice), Event META (must be `active` and still start 24 hours after
  `scheduledFor`), and the registration through GSI5 confirmed
  (`gsi5sk = WAITLIST##REG#{registrationId}`). Otherwise it records
  `outcome=skipped` with a reason and logs `REMINDER_SKIPPED`.
- Delivers, then records `outcome=sent` with `deliveredAt`. Any delivery or
  storage error fails that record only; SQS retries it and then moves it to
  the DLQ (`team32-ceb-reminder-dlq-messages` alarm).

**Log-mode evidence (final sandbox, FR7.2).** `EMAIL_MODE=log` writes one JSON
line per reminder with identifiers and times only:

```json
{"type":"reminder","eventId":"seed-event-community-market","registrationId":"seed-registration-resident-one","scheduledFor":"...","startsAt":"...","mode":"log"}
```

CloudWatch Logs Insights query on log group `team32-ceb-reminder-worker`:

```text
fields @timestamp, eventId, registrationId, scheduledFor, startsAt
| filter type = "reminder" and mode = "log"
| sort @timestamp desc
```

No display name, email address, or token is ever logged or queued.

**SES (debug sandbox only, FR7.6).** Synthesize with CDK context to switch the
worker to SES with a verified sender identity:

```bash
npx cdk deploy team32-ceb-async-monitoring \
  -c reminderEmailMode=ses \
  -c reminderSenderEmail=<verified sender address> \
  -c reminderSenderIdentityArn=<SES identity ARN>
```

Only then does the worker role get `ses:SendEmail`, on that identity alone.
The default synthesis grants no SES permission. The sender address and identity
are passed at deploy time and are never committed. The final sandbox stays in
log mode.

## Statistics (FR8)

`GET /api/admin/stats` (`team32-ceb-admin-stats`) uses C1's JWT authorizer and
`requireAuthenticated` + `requireGroup(["admin"])`: 401
`AUTHENTICATION_REQUIRED` without a valid principal, 403 `FORBIDDEN` for
non-admins, both with the shared `{code, message, field}` body.

| Field               | Definition (working Group C decision)                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `totalRsvps`        | Sum of `confirmedRsvpCount + waitlistCount` (absent means 0) over active Event META (GSI7, all pages).   |
| `pageViews`         | Number of EventView items in GSI7 `VIEW#list` (`Select: COUNT`, all pages).                             |
| `detailViews`       | Number of EventView items in GSI7 `VIEW#detail`.                                                        |
| `popularCategories` | The same RSVP sum per category; counts above 0 only; count descending, then category name ascending.   |

`docs/expected-stats.json` is the FR8.4 oracle for the deterministic seed:
`totalRsvps: 1` and `popularCategories: [{"category":"Community","count":1}]`
exactly, and both view counts as integers of at least 0. The unit tests read the
same file, so the documented values and the tests cannot drift apart.

## Archival (FR9)

`team32-ceb-archival` is invoked directly (no HTTP endpoint): once by the
pipeline after deploy (`{"mode":"postDeploy"}`) and daily by the
`team32-ceb-archival-daily` EventBridge Scheduler schedule
(`{"mode":"scheduled"}`). Any other request fails the invocation.

Eligible events are `lifecycleStatus = active` in GSI7 `LIFECYCLE#active` with
`gsi7sk < START#{cutoff}#`, where the cutoff is `now` minus one calendar year
(February 29 clamps to February 28 in a non-leap target year). Each event goes
through:

1. Conditional `active -> archived` update (also re-checks `startsAt < cutoff`):
   removes the GSI1-GSI3 public keys and sets `gsi7pk = LIFECYCLE#archived` and
   `archivedAt`. C3 mutations require `active`, so the event is frozen.
2. Strongly consistent, fully paginated read of all `REG#` items, then
   `PutObject archive/{eventId}.json` with
   `{schemaVersion:"v1", archivedAt, event, registrations[]}`. Storage keys,
   token digests, and any token-like attribute are stripped.
3. Registration deletes in transactions of up to 25.
4. One transaction: put `EVENT#{id}` / `ARCHIVE` (`archivedAt`,
   `archiveReference`, `registrationCount`) and delete Event META, conditioned
   on `lifecycleStatus = archived`.

Every run first resumes events left in `LIFECYCLE#archived` (reusing their
`archivedAt`), then processes newly eligible ones. The response is
`{scanned, archived, skippedAlreadyArchived, failures}`. Nothing is deleted
before the S3 write succeeds. A per-event failure is logged
(`ARCHIVAL_EVENT_FAILED`), counted in `failures`, and makes the pipeline step
fail.

The C1 seed loader recreates the archive-candidate META only when it is absent,
so each pipeline run archives it again and overwrites the same key, as v1
allows.

**Evidence (FR9.6).** `scripts/archive-invoke.ts` checks, after the invocation,
that `archive/seed-event-archive-candidate.json` in `ArchiveBucketName` exists
and parses as v1, that `GET {SiteUrl}/api/events` does not list the event, and
that `GET {SiteUrl}/api/events/seed-event-archive-candidate` returns 404.

## Pipeline

| Job            | Step                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `test`         | `npm run test:c5-reminders-statistics-archival` (unit tests, 80% line floor)                           |
| `deploy`       | After `npm run seed`: `npm run archive-invoke` through `retry-cli.ts` (3 attempts, 20 s apart)          |
| `health-check` | After the health check: `npm run stats-check` through `retry-cli.ts` (3 attempts, 20 s apart)           |

`stats-check` reads the admin password from `DemoCredentialsSecretArn`, signs in
`admin@example.com` through Cognito SRP, and compares the response with
`docs/expected-stats.json`. Both scripts read only the three approved CI
variables for AWS access and print counts and status only, never credentials,
passwords, or tokens. `deploy.ts` now expects `ArchiveFunctionName` in the C1
output set. `npm run validate` runs both C5 suites.

## IAM (NFR11)

Each function has its own `team32-ceb-<fn>-runtime` role and its own 14-day
`team32-ceb-<fn>` log group.

| Function          | Permissions                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| admin-stats       | `dynamodb:Query` on GSI7                                                                                                                          |
| archival          | Get/Update/Put/Delete/ConditionCheck/Query on the table with `dynamodb:LeadingKeys` `EVENT#*`; Query on GSI7; `s3:PutObject` on `archive/*` only |
| reminder-selector | Query on GSI5 and GSI7; Put/Delete with LeadingKeys `REMINDER#*`; `sqs:SendMessage` on the reminder queue                                          |
| reminder-worker   | GetItem with LeadingKeys `EVENT#*`/`REMINDER#*`; UpdateItem with `REMINDER#*`; Query on GSI5; SQS consume (event source); `ses:SendEmail` only in SES synthesis |

Wildcards are limited to the log-stream suffix and the `archive/*` prefix, each
with a cdk-nag `AwsSolutions-IAM5` suppression (owner Onur, review by
2027-01-03); `LeadingKeys` patterns are condition values, not resource
wildcards. The archival schedule role may invoke only the archival function.

## Tests

```bash
npm run test:c5-reminders-statistics-archival               # unit, with coverage (80% lines)
npm run test:c5-reminders-statistics-archival:integration   # CDK assertions + cdk-nag
```

DynamoDB, S3, SQS, SES, Lambda invoke, Cognito, and Secrets Manager are
replaced by in-memory fakes or injected ports; no test calls AWS. The seed
dataset in the tests comes from `src/seed/fixtures.ts` itself.

## Reminder timing for the seeded event

The seeded community event starts 24 hours after the foundation stack's
`CreationTime`. The original Q3 A window `[now+23h45m, now+24h15m)` would have
selected it only during a run between `CreationTime - 15 min` and
`CreationTime + 15 min`. The reminder schedule exists only after both stacks
finish deploying, and a fresh deploy (CloudFront included) can take longer, so
the final sandbox would likely have logged no reminder (review finding R-01).

Resolution after the code-generation review: the window was widened to
`[now+23h, now+25h)`, which Q3 option B proposed. The seeded event is now
selected by any run up to one hour after `CreationTime`, so a deploy of up to
about 45 minutes still produces the reminder. Duplicates stay impossible
because each `(eventId, registrationId)` gets one ReminderAttempt
(put-if-absent). The trade-off: a reminder may go out up to one hour earlier or
later than exactly 24 hours before the event. The change is confined to C5
(`src/operations/shared/time.ts`); the C1 seed is unchanged. The unit test
"still selects the seeded event when the first run comes 45 minutes after
seeding" covers the slow-deploy case.

## Integration surface

C5 integrates with the foundation and async-monitoring stacks, the shared app
entry point, existing API integration tests, deployment scripts, and the CI
pipeline. These integration points are covered by the corresponding unit and
stack-level tests.

New dependencies, pinned to the existing SDK version: `@aws-sdk/client-lambda`
(pipeline invoke), `@aws-sdk/client-sqs` (selector), `@aws-sdk/client-sesv2`
(debug-only SES path), all `3.1146.0`.

## Contract reconciliation

The reminder (Group B) and statistics (Group C) behavior above is recorded as
the working C5 decision. The contract documentation (`docs/contracts.md` and the
contract summary) still lists these groups as open and needs provider-consumer
reconciliation through the merge request. C-06/C-07 follow v1 unchanged.
