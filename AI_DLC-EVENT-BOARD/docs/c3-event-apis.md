# C3 Event APIs

C3 adds the Community Event Board backend APIs to the shared CDK app: access
control over Cognito JWT claims, organizer/admin event management with banner
presigned POST, public discovery with EventView recording, and RSVP, waitlist,
and token cancellation with atomic capacity transitions. Owner: Onur.

C3 attaches its routes to C1's shared HTTP API and reuses C1's Cognito JWT
authorizer. It adds no C-01 stack output and no `GET /api/admin/stats` route
(C5).

## Layout

| Layer                 | Location                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Access control        | `src/event-api/access/policy.ts`                                                                 |
| EventManagement       | `src/event-api/events/` (keys, validation, repository, service, response shapes)                 |
| Public discovery      | `src/event-api/discovery/` (service, EventView keys, repository, recorder)                       |
| RSVP and waitlist     | `src/event-api/rsvp/` (keys, validation, token, repository, service)                             |
| Banner presigned POST | `src/event-api/banner/banner-service.ts`                                                         |
| HTTP boundary         | `src/event-api/http/` (errors, request parsing, responses and routing, logging, environment)     |
| Lambda entry points   | `src/lambda/event-public/`, `src/lambda/event-management/`, `src/lambda/rsvp/`                   |
| Infrastructure        | `src/infrastructure/event-api.ts` and the C3 changes in `src/infrastructure/foundation-stack.ts` |

EventManagement never imports RSVP code. RSVP reads Event META and changes its
counters only inside DynamoDB transactions conditioned on Event META.

## Routes

| Route                                 | Auth   | Lambda                     | Success                                                     | Errors                  |
| ------------------------------------- | ------ | -------------------------- | ----------------------------------------------------------- | ----------------------- |
| `GET /api/events`                     | Public | `team32-ceb-events-public` | 200 `{events}`                                              | 400                     |
| `GET /api/events/{id}`                | Public | `team32-ceb-events-public` | 200 EventDetail                                             | 404                     |
| `POST /api/events/{id}/rsvps`         | Public | `team32-ceb-rsvp`          | 201 `{status, cancelToken}`; 200 `{status}` for a duplicate | 400, 404                |
| `POST /api/rsvps/cancel`              | Public | `team32-ceb-rsvp`          | 200 `{status: "cancelled"}`                                 | 400, 404, 409           |
| `POST /api/events`                    | JWT    | `team32-ceb-events-manage` | 201 event                                                   | 400, 401, 403           |
| `PUT /api/events/{id}`                | JWT    | `team32-ceb-events-manage` | 200 event                                                   | 400, 401, 403, 404, 409 |
| `DELETE /api/events/{id}`             | JWT    | `team32-ceb-events-manage` | 204, empty body                                             | 401, 403, 404           |
| `POST /api/events/{id}/banner-upload` | JWT    | `team32-ceb-events-manage` | 200 `{url, fields, bannerReference}`                        | 400, 401, 403, 404      |
| `GET /api/organizer/events`           | JWT    | `team32-ceb-events-manage` | 200 `{events}`                                              | 401, 403                |
| `GET /api/admin/events`               | JWT    | `team32-ceb-events-manage` | 200 `{events}`                                              | 400, 401, 403           |

"JWT" routes use C1's existing Cognito JWT authorizer (`AuthorizationType: JWT`
with C1's authorizer ID). Roles come from the `cognito:groups` claim, in either
the bracketed-string form (`"[admin organizer]"`) or the array form:

- Create and the organizer list: `organizer` or `admin`.
- Update, delete, and banner upload: `admin`, or an `organizer` whose `sub`
  equals the event's `organizerSubject`.
- Admin list: `admin` only. Optional query parameters: `status`
  (`active`, `archived`, `deleted`, `cancelled`; default `active`) and
  `organizerSubject`.
- An admin-created event records the admin's `sub` as its owner.

Public responses never include `organizerSubject`, registrations, or email
addresses. Management responses add `organizerSubject` and `lifecycleStatus`.

`GET /api/events` returns active events that start after the current time,
ordered by start time. Optional filters: `category`, `location`, and `date`
(`YYYY-MM-DD`, one UTC calendar day). `GET /api/events/{id}` returns any active
event, including a past one, at its stable URL.

## Error matrix

Every error body is `{code, message, field}`; `field` is `null` when no single
input is at fault.

| Condition                                                              | Status | Code                       |
| ---------------------------------------------------------------------- | -----: | -------------------------- |
| Missing, blank, malformed, or unknown input field                      |    400 | `VALIDATION_ERROR`         |
| Non-future `startsAt` on create                                        |    400 | `EVENT_START_TIME_INVALID` |
| Lambda-detected missing `sub` claim                                    |    401 | `AUTHENTICATION_REQUIRED`  |
| Missing group or not the owner                                         |    403 | `FORBIDDEN`                |
| Unknown or non-active event, unknown or malformed token, unknown route |    404 | `NOT_FOUND`                |
| Reused cancellation token                                              |    409 | `CANCEL_TOKEN_CONSUMED`    |
| Capacity reduced below confirmed RSVPs                                 |    409 | `CAPACITY_CONFLICT`        |
| Unexpected failure                                                     |    500 | `INTERNAL_ERROR`           |

A 500 body carries no internal detail. The function logs one JSON line with the
event `UNHANDLED_ERROR`, the error name, the route key, and the request ID only.

Validation limits (D8): title up to 200 characters, description up to 5000,
location and category up to 100, `capacity` a safe integer of at least 1,
`displayName` up to 100, and `email` up to 254 with a simple address pattern.
Request bodies above 64 KiB are rejected. These length caps bound item size and
are not requirement-derived.

### Known gap: 401 body format (D1)

NFR14 requires protected routes to use the API Gateway JWT authorizer. With an
HTTP API, a missing or invalid JWT is rejected by API Gateway before the Lambda
runs, and HTTP APIs cannot customize that response. Those 401 responses have
API Gateway's own body `{"message":"Unauthorized"}`, not `{code, message,
field}` as AC2.1.3 asks. The status is still 401, so the 401 access-log metric
filter (NFR22) still counts them. Any 401 or 403 the Lambda itself produces uses
`{code, message, field}`. Closing the gap would need Lambda@Edge rewriting or
moving JWT checks into Lambda, which conflicts with NFR14; that decision is
open.

## Data model (effective C-03 v1)

C3 keeps C1's shipped v1 key shapes (`src/seed/fixtures.ts`). The Group A v2
proposal (`WAITQ#` queue rows, `TOKEN#` locators, status-specific GSI5 sort
keys) is not implemented.

- Event META: `pk = EVENT#{eventId}`, `sk = META`, with GSI1-GSI4 and GSI7 keys
  exactly as the seed. `eventId` is a random UUID, so `/events/{id}` is stable.
  Updates rewrite all `START#`-derived index keys in one conditional
  `UpdateItem`. C3 adds the attribute `waitlistCount` (absent reads as 0).
- Soft delete (Q4): `lifecycleStatus = deleted`, GSI1-GSI3 keys removed, GSI7
  partition `LIFECYCLE#deleted`. Registrations are kept. Further edits, RSVPs,
  cancellations, and banner requests on the event return 404.
- Registration: `pk = EVENT#{eventId}`, `sk = REG#{normalizedEmail}`,
  `gsi5pk = REGISTRATION#EVENT#{eventId}#STATUS#{status}`,
  `gsi5sk = WAITLIST#{waitlistedAt}#REG#{registrationId}` (empty
  `waitlistedAt` for confirmed), `gsi6pk = CANCEL#{sha256(token)}`.
- EventView: `pk = VIEW#{uuid}`, `sk = META`, `gsi4pk`/`gsi7pk = VIEW#{viewType}`,
  `gsi4sk`/`gsi7sk = AT#{viewedAt}#EVENT#{eventId}`. The list view uses
  `eventId = LIST`.

## RSVP, waitlist, and cancellation

- Identity is `(eventId, lower-cased email)`. A duplicate returns 200 with the
  existing status and no token.
- The cancellation token is 32 random bytes, base64url-encoded, and returned
  once in the 201 body. Only its SHA-256 hex digest is stored. The token is
  never logged.
- Admission (D3) is a transaction that increments `confirmedRsvpCount` only when
  the event is active, `confirmedRsvpCount < capacity`, and nobody is waiting
  (`waitlistCount` absent or 0), together with a registration put that succeeds
  only for an absent or cancelled registration. Otherwise the RSVP is
  waitlisted in a transaction that increments `waitlistCount` and stores
  `waitlistedAt`. Capacity can never be exceeded.
- Cancellation sets `status = cancelled` in a transaction conditioned on the
  registration's current status and on Event META. A confirmed cancellation
  frees the seat and then promotes waitlist heads; a waitlisted cancellation
  only decrements `waitlistCount`. A reused token returns 409.
- Retryable `TransactionConflict` cancellations and lost races are retried with
  jittered backoff, up to 8 attempts, then fail loudly with a 500.

### v1 consistency limits (D2, D4)

- GSI6 (token lookup) and GSI5 (waitlist head) are eventually consistent. A
  cancellation submitted within about a second of its RSVP may return 404 until
  GSI6 catches up.
- Promotion picks the head GSI5 currently shows. A waiter written within about
  a second may not be visible yet, so a slightly later waiter could be promoted
  first. If the selected head changed concurrently, its transaction condition
  fails; C3 re-reads up to 3 times and then defers promotion, logging
  `{"level":"warn","event":"WAITLIST_PROMOTION_DEFERRED","eventId":...,"reason":"stale-head"}`
  (or `"head-not-visible"`).
- An event update only changes capacity, conditioned on
  `capacity >= confirmedRsvpCount`, because EventManagement must not depend on
  RSVP. Waiters are drained lazily: before admitting a new RSVP and after a
  confirmed cancellation. Until then, seats added by a capacity increase can
  stay empty while people wait.

These are the cases the Group A v2 proposal was written to close.

## Banner upload and serving

- `POST /api/events/{id}/banner-upload` accepts `contentType` `image/jpeg`,
  `image/png`, or `image/webp`, and authorizes the owner or an admin.
- The object key is `banners/{eventId}/{uuid}.{jpg|png|webp}`. The presigned
  POST (`@aws-sdk/s3-presigned-post`) carries the conditions
  `["content-length-range", 1, 5242880]` and `["eq", "$Content-Type", <type>]`,
  the field `Content-Type`, and a 300-second expiry. S3 enforces the 5 MB limit.
- `bannerReference` (the key) is stored on Event META when the URL is issued,
  because the C-02 `EventWrite` schema has no banner field. If the browser
  upload never completes, the reference points to a missing object; C4 should
  tolerate a missing banner image.
- The banner bucket has a CORS rule for browser POST from
  `https://*.cloudfront.net` (method `POST`, any header, max age 3000 s). Using
  the exact distribution domain would create a CloudFormation dependency cycle.
  CORS is not an access boundary here; the signed POST policy is.
- CloudFront serves `banners/*` read-only (`GET`/`HEAD`) from the banner bucket
  through Origin Access Control with the optimized cache policy, at
  `{SiteUrl}/{bannerReference}`. Only CloudFront can read the bucket, and the
  browser never receives write credentials.
- The UI error message for an S3 rejection (5 MB limit and allowed types)
  belongs to C4.

## EventView recording and `EVENT_VIEW_RECORD_FAILED` (for C6)

List and detail reads write an EventView item after the read succeeds. A failed
view write never fails the page. It logs exactly one JSON line, with no
personal data, to the `team32-ceb-events-public` log group:

```json
{
  "level": "error",
  "event": "EVENT_VIEW_RECORD_FAILED",
  "viewType": "list",
  "eventId": "LIST",
  "errorName": "ProvisionedThroughputExceededException"
}
```

A metric filter and alarm for this line are implemented by the C6
async-monitoring component.

## Runtime and IAM boundaries

Each function runs on Node.js 22.x with its own role and its own log group with
14-day retention and `RemovalPolicy.RETAIN`. The pinned AWS SDK v3 packages are
bundled into each function. Environment variables are `TABLE_NAME` and, for
`team32-ceb-events-manage`, `BANNER_BUCKET_NAME`; no secrets. A missing variable
fails the invocation with a clear error.

| Function                   | DynamoDB                                                                                                   | Other                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `team32-ceb-events-public` | `GetItem` (leading key `EVENT#*`), `PutItem` (leading key `VIEW#*`), `Query` on GSI1-GSI3                  | -                             |
| `team32-ceb-events-manage` | `GetItem`, `PutItem`, `UpdateItem` (leading key `EVENT#*`), `Query` on GSI4 and GSI7                       | `s3:PutObject` on `banners/*` |
| `team32-ceb-rsvp`          | `GetItem`, `PutItem`, `UpdateItem`, `ConditionCheckItem` (leading key `EVENT#*`), `Query` on GSI5 and GSI6 | -                             |

DynamoDB authorizes each item inside `TransactWriteItems` against these per-item
actions. Table and index ARNs are named explicitly.

| Wildcard boundary                                         | Owner | Justification                                                                    | Review date |
| --------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- | ----------- |
| Lambda log-stream suffix under each C3 function log group | Onur  | CloudWatch Logs requires stream-level writes; scoped to one log group each.      | 2027-01-03  |
| `banners/*` object prefix in the banner bucket            | Onur  | Presigned POST is signed with the role; bounded to the banner key prefix.        | 2027-01-03  |
| `EVENT#*` / `VIEW#*` DynamoDB leading-key conditions      | Onur  | Narrows item access to the entity partitions each function owns (a restriction). | 2027-01-03  |

### CDK Nag exceptions

| Rule                 | Resource                   | Justification                                                                           |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `AwsSolutions-L1`    | The three C3 functions     | Node.js 22.x is explicitly required (NFR3); review before AWS deprecation.              |
| `AwsSolutions-IAM5`  | The three C3 runtime roles | Log-stream wildcard and the `banners/*` prefix only, matched with `appliesTo` patterns. |
| `AwsSolutions-APIG4` | The four public routes     | C-02 defines browse, detail, RSVP, and token cancellation as public, without sign-in.   |

Each is owned by Onur and must be reviewed by 2027-01-03. The C3 `cdk-nag` test
includes a positive control that removes these suppressions and asserts the
findings appear.

## Teardown

The three C3 log groups use `RemovalPolicy.RETAIN` and carry the
`project=team32-ceb` tag, so the C2 tag-based teardown finds and deletes them.

## Tests and commands

No AWS credentials or network access are needed.

```text
npm run test:c3-event-apis              # unit tests with coverage (80% line floor)
npm run test:c3-event-apis:integration  # CDK assertions and AwsSolutions cdk-nag
npm run validate                        # includes both C3 commands
```

The C3 coverage floor applies to `src/event-api/**` and the three C3 Lambda
entry points. DynamoDB is replaced by an atomic in-memory fake
(`test/c3-event-apis/support/fake-dynamodb.ts`) that models only the commands and
expressions C3 uses and throws on anything else. The dedicated RSVP concurrency
proof is `test/c3-event-apis/unit/rsvp-concurrency.test.ts`.

### CI integration

The `.gitlab-ci.yml` `test` job runs `npm run test:c3-event-apis` and
`npm run test:c3-event-apis:integration`.
