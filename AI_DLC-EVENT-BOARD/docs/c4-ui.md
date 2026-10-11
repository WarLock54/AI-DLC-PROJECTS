# C4 Web UI

C4 is the Community Event Board browser UI: public event browsing and filtering,
shareable event detail pages, RSVP with a one-time cancellation link,
organizer/admin sign-in, organizer and admin event management with banner
upload, and the admin statistics page. It is plain TypeScript with no UI
framework, bundled with the pinned `esbuild`, and calls the C3 API on the same
CloudFront origin (`/api/*`), so API calls need no CORS.

The CDK app builds the UI during synthesis. A Node.js 22.x custom resource
publishes it, with a deploy-time `config.json`, into the existing web bucket.
The pipeline health check proves the UI is served.

## Layout

| Part                                   | Location                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| HTML shell and styles                  | `ui/index.html`, `ui/styles.css`                                    |
| Entry point and composition            | `ui/src/main.ts`, `ui/src/app.ts`                                   |
| Router and role guards                 | `ui/src/router.ts`, `ui/src/auth/roles.ts`                          |
| Sign-in and session                    | `ui/src/auth/session.ts`, `ui/src/auth/return-target.ts`            |
| API client and C-02 types              | `ui/src/api/client.ts`, `ui/src/api/types.ts`                       |
| User-facing copy                       | `ui/src/copy.ts`                                                    |
| Banner upload                          | `ui/src/banner/upload.ts`, `ui/src/components/banner-uploader.ts`   |
| Pages and components                   | `ui/src/pages/`, `ui/src/components/`                               |
| Build, deployment, CloudFront Function | `src/infrastructure/web-ui.ts`, `src/infrastructure/spa-rewrite.ts` |
| Web deployment handler                 | `src/lambda/web-deploy/deploy.ts` (logic), `handler.ts` (entry)     |
| UI health check                        | `scripts/health-check-ui.ts`, called by `scripts/health-check.ts`   |
| Tests                                  | `test/c4-ui/unit/`, `test/c4-ui/integration/`                       |

`ui/tsconfig.json` type-checks `ui/src/**` and `test/c4-ui/unit/**` with DOM
types. The root `tsconfig.json` excludes both. `npm run build` checks both
configurations.

## Routes

| Route               | Access                 | API calls                                                               |
| ------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `/`                 | Public                 | Redirects to `/events`                                                  |
| `/events`           | Public                 | `GET /api/events` (optional `date`, `category`, `location`)             |
| `/events/{id}`      | Public                 | `GET /api/events/{id}`, `POST /api/events/{id}/rsvps`                   |
| `/rsvp/cancel`      | Public (one-time link) | `GET /api/events/{id}` (title only), `POST /api/rsvps/cancel`           |
| `/sign-in`          | Public                 | Cognito SRP sign-in                                                     |
| `/organizer/events` | `organizer` or `admin` | `GET /api/organizer/events`, create/update/delete, banner upload        |
| `/admin/events`     | `admin`                | `GET /api/admin/events?status=...`, create/update/delete, banner upload |
| `/admin/stats`      | `admin`                | `GET /api/admin/stats`                                                  |
| anything else       | Public                 | Not-found page with a link to `/events`                                 |

Route guards only shape navigation. The API remains the authorization boundary
for every request. A protected route opened without a session goes to
`/sign-in?returnTo=<path>`. A signed-in user on a route their role may not open
goes to their default route: `/admin/events` for admins and `/organizer/events`
for organizers.

After sign-in, `returnTo` is used only when it starts with a single `/`,
contains no `//`, `\`, `:`, `#`, or control characters (checked raw and
URL-decoded), names one of the three protected routes, and the signed-in role
may open that route. Otherwise the user lands on the role default.

## Runtime configuration (`/config.json`)

The UI loads `/config.json` with `cache: "no-store"` at start-up. It must
contain `region`, `userPoolId`, and `userPoolClientId`. A missing or invalid
file shows a full-page service error; the UI never falls back to built-in
values. The web deployment writes this file at deploy time from the stack's own
region and Cognito resources, so no new stack output is added (C-01 stays at
exactly 11 outputs).

## Sign-in and session

- `amazon-cognito-identity-js` (exact-pinned) signs in through the existing
  SRP-only app client. No Cognito infrastructure changes.
- Tokens are stored in `sessionStorage`, so they do not outlive the tab session.
- The API receives the ID token as `Authorization: Bearer <token>`. Groups from
  its `cognito:groups` claim (array or `"[a b]"` string form) drive navigation
  only.
- `NotAuthorizedException` and `UserNotFoundException` both show "Email or
  password is incorrect." The email is kept and the password is cleared. Any
  other Cognito failure, or any challenge such as a new-password or MFA prompt,
  shows a distinct service message with **Retry**. The password is kept there,
  so Retry can resend it.
- If a token refresh fails, the user is signed out. Sign-out clears the stored
  Cognito keys and returns to `/events`.
- A 401 on a protected API call clears the session and returns the user to
  `/sign-in?returnTo=<current path>`. API Gateway's own 401 body
  (`{"message":"Unauthorized"}`, C3 D1) maps to `AUTHENTICATION_REQUIRED`.

All user-facing error text comes from one table keyed by C-02 error code
(`ui/src/copy.ts`). Raw codes are never shown.

## CloudFront rewrite rules

`team32-ceb-spa-rewrite` is a `cloudfront-js-2.0` viewer-request function on the
default (web bucket) behavior only. The `api/*` and `banners/*` behaviors have
no function association, and the distribution has no custom error responses,
so `/api/*` keeps its JSON 403/404 bodies.

| Request URI                                              | Result        |
| -------------------------------------------------------- | ------------- |
| `/api`, `/api/*`, `/banners`, `/banners/*`               | Unchanged     |
| Last path segment contains `.` (e.g. `/app.js`)          | Unchanged     |
| Anything else (e.g. `/`, `/events/{id}`, `/admin/stats`) | `/index.html` |

The query string is never modified. The unit tests evaluate the exact source
string that is deployed.

## Build

`buildWebUi()` in `src/infrastructure/web-ui.ts` bundles `ui/src/main.ts` into a
minified ES2022 browser module, `app.js` (no source maps), and copies
`index.html` and `styles.css` into `cdk.out/.team32-ceb-web-ui/<process id>/`.
Each process gets its own folder, so parallel test workers never write the same
files. The output is deterministic, so the asset hashes change only when the UI
changes. A compile error throws esbuild's message and fails synthesis. The
`WebUi` construct calls the build once per process during synthesis. Every
`cdk synth`, `npm run deploy`, and CDK test therefore builds the same UI,
without a separate build step or a `.gitlab-ci.yml` change.

## Web deployment

Human decision (Onur, 2026-10-06): CDK `BucketDeployment`'s helper Lambda runs
Python 3.13. That conflicts with NFR3 and the C1 test "runs every Lambda
function on Node.js 22.x". It is replaced by a Node.js 22.x custom resource.

- **Assets.** `index.html`, `app.js`, and `styles.css` are each a CDK file
  asset, uploaded unchanged to the CDK asset bucket.
- **Handler.** `team32-ceb-web-deploy` is a Node.js 22.x `NodejsFunction`
  bundled like the C3 functions. It is the service token of the
  `Custom::Team32CebWebDeployment` resource and uploads the CloudFormation
  response itself, so no Provider framework Lambda is added. Every Lambda in
  the stack stays Node.js 22.x.
- **Create and Update.** In order, the handler:
  1. Copies each asset into the web bucket with `CopyObject` (server-side, no
     download), setting `Content-Type` and `Cache-Control`. `index.html` gets
     `no-cache`; `app.js` and `styles.css` get
     `public, max-age=300, must-revalidate`.
  2. Writes `config.json` (`no-cache`) from the resource properties `region`,
     `userPoolId`, and `userPoolClientId`.
  3. Deletes objects that the previous properties listed and the new ones do not
     (prune). It never deletes anything it did not write.
  4. Creates a CloudFront invalidation for `/index.html`, `/config.json`,
     `/app.js`, and `/styles.css`, then polls it for up to 5 minutes. If it is
     still in progress after that, the resource succeeds, reports
     `InvalidationStatus: InProgress`, and logs `WEB_DEPLOY_INVALIDATION_PENDING`.
     CloudFront finishes it on its own.
- **Failures.** Invalid properties, or a failed copy, write, delete, or
  invalidation call, return `FAILED` with a clear reason, for example
  `Copying app.js into the web bucket failed: AccessDenied.` The deployment then
  fails and rolls back. Reasons and logs carry only the step and the error name,
  never ARNs or SDK messages.
- **Delete.** Nothing is removed. The web bucket is retained like every C1
  bucket; cleanup stays with the C2 teardown.
- **Logs.** `team32-ceb-web-deployment`, 14-day retention, `RETAIN`.
- **IAM** (role `team32-ceb-web-deploy-runtime`):
  - `s3:GetObject` on the three exact asset objects.
  - `s3:PutObject` and `s3:DeleteObject` on the web bucket's objects.
  - `cloudfront:CreateInvalidation` and `cloudfront:GetInvalidation` on the one
    distribution ARN.
  - Log writes to its own log group.

### CDK Nag exceptions

Each exception is owned by Onur and due for review by 2027-01-03.

| Rule                | Resource                        | Justification                                                                                                                                                                          |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AwsSolutions-L1`   | `team32-ceb-web-deploy`         | Node.js 22.x is required by NFR3.                                                                                                                                                      |
| `AwsSolutions-IAM5` | `team32-ceb-web-deploy-runtime` | Log-stream wildcard, bounded to `team32-ceb-web-deployment`. The web bucket object wildcard (`<WebBucket>/*`) is needed to publish and prune UI files; the bucket holds only UI files. |

The C4 `cdk-nag` test includes a positive control that removes these
suppressions and asserts that exactly these findings appear.

## Health check

`npm run health-check` (`scripts/health-check.ts`) keeps the existing
`/api/health` check and then calls `checkUi` (`scripts/health-check-ui.ts`). It
requires:

- `GET {SiteUrl}/events` to return 200 `text/html`, which proves the deep-link
  rewrite, and
- `GET {SiteUrl}/config.json` to return 200 JSON with non-empty `userPoolId`
  and `userPoolClientId`.

Any failure exits non-zero with a clear message, so the pipeline cannot pass
with a missing UI.

## Cancellation link

A new RSVP (201) shows a one-time link:

```text
/rsvp/cancel?event={eventId}&joined={confirmed|waitlisted}#token={cancelToken}
```

The token is in the URL fragment. Browsers never send a fragment to the server
or in a `Referer` header, so the token does not reach CloudFront logs. The page
also sets `<meta name="referrer" content="no-referrer">`. The token is never
shown as text or logged. It is only sent in the JSON body of
`POST /api/rsvps/cancel`, and only after the resident confirms in a native
`<dialog>`. Escape and Cancel close the dialog and return focus to the trigger;
opening the link alone never cancels.

A 200 for a duplicate RSVP shows the existing status and says that the original
link still applies. A 404 or 409 on cancel, or a link with no token, shows
"This cancellation link is invalid or has already been used." with links back
to the event and to `/events`.

## Banner upload

The uploader is enabled only for an existing event, including straight after a
create.

1. Before any request: the type must be `image/jpeg`, `image/png`, or
   `image/webp`, and the size must be 1 to 5,242,880 bytes. Otherwise the
   uploader shows "Choose a JPEG, PNG, or WebP image no larger than 5 MB."
2. `POST /api/events/{id}/banner-upload` with `{contentType}` returns the
   presigned POST.
3. The browser builds `FormData` with every returned field in order and the
   file last under `file`, and sends `fetch(url, {method: "POST", body})`
   directly to S3. It sets no `Content-Type` header (the browser adds the
   multipart boundary) and sends no `Authorization` header.
4. A 204 or 201 is a success, and the preview uses `/{bannerReference}`. Any other S3
   status, including `EntityTooLarge` or a policy failure, shows the same
   5 MB / allowed-types message. A network failure shows "The upload failed.
   Your event details are saved. Try again." The event form values are never
   cleared by an upload failure.

## Tests and commands

No AWS credentials or network access are needed.

```text
npm run test:c4-ui              # UI unit and behavior tests with coverage (80% line floor)
npm run test:c4-ui:integration  # CDK assertions, build output, and AwsSolutions cdk-nag
npm run validate                # includes both C4 commands
```

The coverage floor covers `ui/src/**`, `src/infrastructure/spa-rewrite.ts`,
`src/lambda/web-deploy/**`, and `scripts/health-check-ui.ts`. The C1 config
excludes `src/lambda/web-deploy/**`, the same way it excludes the C3 handlers.
The fake API (`test/c4-ui/unit/support/fake-api.ts`) answers C-02 routes from
the deterministic seed shapes in `src/seed/fixtures.ts`. All test identities
and tokens are synthetic.

## Known limits

- **Single-date filter.** C-02 accepts one `date=YYYY-MM-DD`, not a range, so
  the date filter is one date input.
- **Status at join on the cancellation page.** C-02 has no endpoint for the
  current RSVP state, so the page shows the status from when the resident
  joined (carried in the link).
- **Statistics unavailable until C5.** Until C5 adds `GET /api/admin/stats`, the
  statistics page shows "Statistics are unavailable right now." with Retry. It
  never shows zeros in place of an error.
- **Missing banner objects.** C3 stores `bannerReference` when it issues the
  upload URL. If an upload never completes, the image request fails and the
  browser shows no image.

## Teardown

The web deployment's Lambda, role, and log group carry the
`project=team32-ceb` tag. The log group uses `RemovalPolicy.RETAIN`, so the C2
tag-based teardown finds and deletes it.

## CI integration

The `.gitlab-ci.yml` `test` job runs `npm run test:c4-ui` and
`npm run test:c4-ui:integration`. The `lint` job runs `build`, `lint`, and
`format:check`, which also cover `ui/`.
