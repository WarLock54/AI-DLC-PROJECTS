# Integration Contracts — Community Event Board

Readable summary of the approved contracts. The full machine-readable versions (OpenAPI, AsyncAPI, shared schemas) are in `aidlc/spaces/default/intents/261001-community-event-board/inception/contract-design/contract-summary.md`. All contracts are `v1`; breaking changes (removals, new required fields, status/code changes, key-shape changes, output renames) need provider–consumer agreement through a merge request.

## Overview

| \# | Contract | Provider (owner) | Consumers |
| :---- | :---- | :---- | :---- |
| C-01 | Stack outputs | C1 Foundation, C6 Async/Monitoring | C2, C4, C5, C7 |
| C-02 | HTTP API \+ error matrix | C3 Event APIs; C5 for statistics; C1 for health | C4, C2, C7 |
| C-03 | DynamoDB single-table model | C1 (table), C3 (Event/Registration), C5 (archival/statistics reads) | C3, C5 |
| C-04 | Banner upload policy | C3 | C4, C7 |
| C-05 | Reminder queue message | C6 (queue), C5 (payload) | C5, C7 |
| C-06 | Archival invocation (direct Lambda invoke) | C5 (behaviour), C1 (`ArchiveFunctionName`) | **C2 (post-deploy invoke)**, C7 |
| C-07 | S3 archive object | C5 (content), C1 (bucket) | C7 |
| C-08 | Pipeline evidence and monitoring | C2, C6, C7 | C7, maintainers |

## C-01 Stack outputs (exact set)

| Output | Meaning |
| :---- | :---- |
| `SiteUrl` | CloudFront URL of the app |
| `ApiBaseUrl` | Same value as `SiteUrl` (CloudFront routes `/api/*` to API Gateway; no CORS) |
| `UserPoolId`, `UserPoolClientId` | Cognito IDs for the UI |
| `WebBucketName`, `DistributionId` | Static site upload and cache invalidation |
| `BannerBucketName` | Banner objects under `banners/` |
| `TableName` | DynamoDB single table |
| `ArchiveFunctionName` | Archival Lambda invoked by the pipeline |
| `ArchiveBucketName` | Archive objects under `archive/` |
| `ReminderQueueUrl` | Reminder SQS queue |
| `AlarmTopicArn` | SNS topic for alarms |
| `DemoCredentialsSecretArn` | Secrets Manager ARN (value is never output) |
| `Region` | From `AWS_DEFAULT_REGION` (`us-east-1`, `eu-west-1` or `ap-south-1`) |

No secret values in outputs. Names use `team32-ceb-`, tag `project=team32-ceb`.

## C-02 HTTP API

| Method | Path | Auth | Success | Notes |
| :---- | :---- | :---- | :---- | :---- |
| GET | `/api/health` | public | 200 `{"status":"ok"}` | Pipeline health check via `{SiteUrl}/api/health` |
| GET | `/api/events?date&category&location` | public | 200 `{events:[EventSummary]}` | Records EventView `list` |
| GET | `/api/events/{id}` | public | 200 EventDetail | Records EventView `detail` |
| POST | `/api/events` | organizer/admin | 201 EventDetail | Start time must be in the future |
| PUT | `/api/events/{id}` | owner or admin | 200 EventDetail | 409 if capacity \< confirmed count |
| DELETE | `/api/events/{id}` | owner or admin | 204 | Then GET returns 404 |
| GET | `/api/organizer/events` | organizer | 200 own events | For `/organizer/events` |
| GET | `/api/admin/events?status&organizerSubject` | admin | 200 all events | For `/admin/events` |
| POST | `/api/events/{id}/rsvps` | public | 201 `{status, cancelToken}` / 200 `{status}` | Idempotent by `(eventId, lower-cased email)`; duplicate (200) never returns a token |
| POST | `/api/rsvps/cancel` | public | 200 `{status:"cancelled"}` | Token in JSON body, never in the URL |
| POST | `/api/events/{id}/banner-upload` | owner or admin | 200 `{url, fields, bannerReference}` | Presigned POST |
| GET | `/api/admin/stats` | admin | 200 `{totalRsvps, pageViews, detailViews, popularCategories}` | Matches seed expected-values file |

### Error matrix (body `{code, message, field}`)

| Condition | Status | Code |
| :---- | :---- | :---- |
| Missing/invalid field | 400 | `VALIDATION_ERROR` |
| Event start time not in the future (API create) | 400 | `EVENT_START_TIME_INVALID` |
| Missing/invalid JWT | 401 | `AUTHENTICATION_REQUIRED` |
| Wrong role or not owner | 403 | `FORBIDDEN` |
| Unknown event, unknown/malformed cancel token | 404 | `NOT_FOUND` |
| Cancel token already used | 409 | `CANCEL_TOKEN_CONSUMED` |
| Capacity reduced below confirmed count | 409 | `CAPACITY_CONFLICT` |

## C-03 Data model (key shapes)

| Item | pk | sk | Main GSI keys |
| :---- | :---- | :---- | :---- |
| Event | `EVENT#{eventId}` | `META` | GSI1 `EVENT#ACTIVE` / `START#…`; GSI2 category; GSI3 location; GSI4 organizer; GSI7 lifecycle |
| ArchivedEvent | `EVENT#{eventId}` | `ARCHIVE` | — |
| Registration | `EVENT#{eventId}` | `REG#{normalizedEmail}` | GSI5 status \+ `WAITLIST#{waitlistedAt}`; GSI6 `CANCEL#{tokenDigest}` |
| ReminderAttempt | `REMINDER#{eventId}` | `REG#{registrationId}` | put-if-absent prevents duplicates |
| EventView | `VIEW#{viewId}` | `META` | GSI7 `VIEW#{viewType}` |

Invariants: `confirmedRsvpCount ≤ capacity`; one active registration per `(eventId, normalizedEmail)`; waitlist \= Registration with `status=waitlisted` ordered by `waitlistedAt`; cancel tokens stored only as digests.

## C-04 Banner upload

- Request `{contentType}` with `image/jpeg`, `image/png` or `image/webp`.  
- S3 policy: `content-length-range` 1–5,242,880 bytes, allowed content types as above.  
- `bannerReference` is the S3 key under `banners/`, shown as `{SiteUrl}/banners/{key}`.  
- On S3 rejection the UI shows an error naming the 5 MB limit and the allowed types.

## C-05 Reminder queue message

`ReminderQueueMessageV1 = {eventId, registrationId, scheduledFor}` only — no names, emails or tokens. Retries through SQS redrive; DLQ required; one ReminderAttempt per `(eventId, registrationId)`.

## C-06 Archival invocation

- Invoked directly (no HTTP endpoint) by the C2 pipeline after deploy and by a daily schedule, using `ArchiveFunctionName`.  
- Request `{mode: "postDeploy" | "scheduled"}`; response `{scanned, archived, skippedAlreadyArchived, failures}`.  
- Idempotent; active data removed only after the S3 write succeeds.

## C-07 Archive object

`archive/{eventId}.json` in `ArchiveBucketName`: `{schemaVersion:"v1", archivedAt, event, registrations[]}`. No raw cancel tokens or secrets.

## Pending reconciliation: C5 working decisions (Groups B and C)

C5 implements the following as its **working decisions** while contract Groups B (C-05 reminders) and C (statistics semantics) remain open. They need provider–consumer reconciliation through the C5 merge request before this document treats them as approved. Details: `docs/c5-reminders-statistics-archival.md`.

- **Group B (reminders):** selection window `[now+23h, now+25h)` every 15 minutes (widened from `[now+23h45m, now+24h15m)` so the seeded event is still selected after a slow first deploy); one ReminderAttempt per `(eventId, registrationId)`, put-if-absent with `outcome` `queued` → `sent` or `skipped`; the C-05 message is sent after the attempt and the attempt is rolled back if the send fails; the worker re-checks event and registration state before delivering; partial batch failures are retried by SQS and then moved to the DLQ; `EMAIL_MODE=log` by default, SES only in the debug sandbox.
- **Group C (statistics):** `totalRsvps` = sum of `confirmedRsvpCount + waitlistCount` over active events; `pageViews`/`detailViews` = EventView counts per type; `popularCategories` = the same RSVP sum per category, counts above 0, sorted by count then name. `docs/expected-stats.json` requires exact RSVP-derived values and a lower bound for view counts.

C-06 and C-07 are implemented as approved `v1`; the Group A write-once (`v2`) proposal is not implemented.

## C-08 Evidence and monitoring

- Final pipeline: `validate → deploy → health check`; idempotent `cdk bootstrap`; never destroys.  
- Gates: ESLint, Prettier, unit tests with coverage (80% on backend business logic), `cdk synth`, CDK assertions, `cdk-nag` AwsSolutions, `npm audit`, secret scanning, prohibited-token check.  
- Monitoring: alarms for API 5xx, latency, Lambda errors/throttles, DLQ \> 0; metric filters for 401 and 403; 14-day log retention.  
- Debug-only evidence: `TEARDOWN=true` cleanup (`docs/cleanup.md`), real SES email, 500-user load test (`docs/load-test.md`), cost notes.