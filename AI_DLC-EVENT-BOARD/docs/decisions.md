# Decision Record — Community Event Board

Short record of the main architecture decisions, the alternatives rejected, and what would change if the budget were halved. Full reasoning lives in the AI-DLC artifacts under `aidlc/spaces/default/intents/261001-community-event-board/` (feasibility, requirements-analysis, domain-design `decisions.md`, contract-design).

## Context and constraints

- About 50,000 residents, weekend peaks, target 500 concurrent users, p95 API latency \< 1 s (NFR7, NFR8).  
- Monthly cost target under \$30 (NFR9); single AWS region; 8-hour ephemeral sandbox accounts.  
- Final verification runs in a fresh account from GitLab CI with no manual console steps (NFR1).  
- Lambda account concurrency limit 400; SES account is in sandbox mode.

## Decisions

| \# | Decision | Alternatives rejected | Why |
| :---- | :---- | :---- | :---- |
| D1 | Serverless stack: CloudFront \+ S3, API Gateway HTTP API, Lambda (Node.js 22.x, TypeScript), DynamoDB on-demand | ECS/Fargate \+ RDS; EC2 | Scales to zero (fits \< \$30), no servers to patch, deploys cleanly in a fresh account; Fargate/RDS have always-on cost and longer provisioning. |
| D2 | IaC with AWS CDK v2 (TypeScript) | Terraform; CloudFormation YAML | Same language as the app; CloudFormation keeps state in the account, so no remote state/locking needed for ephemeral sandboxes. Pipeline runs idempotent `cdk bootstrap`. |
| D3 | DynamoDB single table with Event and Registration in the same partition (`EVENT#{id}`) | Separate tables; RDS with row locks | One `TransactWriteItems` updates the capacity counter and the registration atomically, so concurrent RSVPs can never overbook (FR5.5). |
| D4 | RSVP identity `(eventId, lower-cased email)`, idempotent; cancel token returned once on 201 and stored only as a digest | Resident accounts; returning the token on duplicates | No sign-in for residents; returning tokens on duplicates would let anyone who knows an email cancel someone else's RSVP. |
| D5 | Cognito User Pool with `organizer` and `admin` groups \+ API Gateway JWT authorizer | Custom auth in Lambda; IAM auth | Managed, no secrets in code; demo users seeded with `example.com` addresses, passwords only in Secrets Manager. |
| D6 | Banner upload via S3 presigned POST (1–5,242,880 bytes, JPEG/PNG/WebP), served through CloudFront `/banners/*` | Upload through Lambda/API Gateway | API Gateway payload limits and Lambda cost; S3 enforces the policy itself. |
| D7 | Same-origin routing: CloudFront `/api/*` → API Gateway, so `ApiBaseUrl = SiteUrl` | Separate API domain with CORS | No CORS configuration, one HTTPS entry point, simpler UI config. |
| D8 | Reminders are schedule-driven only: EventBridge Scheduler every 15 min → selector → SQS → worker, DLQ on failure | Event-driven change stream from RSVP; cron inside one Lambda | Selection reads current state, so edited/cancelled/archived events are excluded naturally; SQS gives retries and a DLQ. |
| D9 | `EMAIL_MODE=log` in the final sandbox; real SES only in the debug sandbox with a verified personal address | Real SES everywhere | SES sandbox cannot email unverified recipients in a fresh account. |
| D10 | Archival orchestrated by PlatformOperations: write `archive/{eventId}.json` to S3 first, then remove active registrations and event; invoked daily and once by the pipeline (direct Lambda invoke, no HTTP endpoint) | EventManagement deleting RSVP data directly; DynamoDB TTL | Keeps entity ownership clean (no EventManagement → RSVP dependency), idempotent re-runs, readable S3 evidence. |
| D11 | Normal `main` pipeline deploys and never destroys; teardown only through an explicit `TEARDOWN=true` job in the debug sandbox | Destroy at the end of every pipeline | Final deployment must stay running for inspection (NFR17, NFR20). |
| D12 | Region read from `AWS_DEFAULT_REGION` (default `us-east-1`; allowed `us-east-1`, `eu-west-1`, `ap-south-1`), never hardcoded | Hardcoded region | The final orchestrator supplies the region variable. |
| D13 | Monitoring: alarms for API 5xx, API latency, Lambda errors/throttles, DLQ \> 0; metric filters for 401/403; all log groups 14-day retention | Third-party APM | Native, low cost, visible to the verifier. |

## Capacity and cost reasoning

- 500 concurrent users with sub-second responses needs far fewer than 400 concurrent Lambda executions (rough Little's-law estimate: about 40 at peak); reserved concurrency stays ≤ 300 in total.  
- DynamoDB on-demand, Lambda, API Gateway HTTP API and S3/CloudFront are pay-per-request; at the expected traffic the monthly cost stays well under \$30. The 500-user load test runs only in the debug sandbox (`docs/load-test.md`).

## If the budget were halved

- Keep the serverless stack (it already scales to zero).  
- Drop the API latency alarm and keep only error/throttle/DLQ alarms; shorten log retention to 7 days.  
- Reduce reminder schedule frequency (for example hourly) and limit GSIs to the public-list and waitlist indexes.

## Trade-offs accepted

- Minimal UI and no resident accounts (by scope).  
- DAST deferred for the MVP (NFR27).  
- Hot partition `EVENT#ACTIVE` on GSI1 is acceptable at 500 concurrent users.