# Design Review Checklist — Community Event Board

Use this checklist when reviewing architecture and implementation changes. Record
the review outcome in the relevant change request; this checklist does not assign
work to individual contributors.

## I2 acceptance criteria

| Criterion | Evidence | Reviewer check |
|---|---|---|
| The architecture covers the main scenario requirements and AWS constraints | `docs/architecture.md`, `docs/decisions.md`, AI-DLC `requirements-analysis/requirements.md` (FR1–FR10, NFR1–NFR31) | [ ] |
| API, data and deployment responsibilities are clear enough to begin implementation | `docs/contracts.md`, AI-DLC `units-generation/` (C1–C7) and `delivery-planning/` | [ ] |
| The design is reviewed before implementation | Review approval and resolved comments | [ ] |

## Review focus (from the I2 issue: deployability, UI needs, cost, operations)

| Area | Question | Where to look | OK? |
|---|---|---|---|
| Deployability | Can the stack deploy into a fresh account with only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`? | decisions D2, D11, D12; contracts C-01, C-08 | [ ] |
| Deployability (C2) | Are the stack output names and the health check (`{SiteUrl}/api/health`) enough for the pipeline? | contracts C-01, C-08 | [ ] |
| UI needs (C4) | Do the API paths, error matrix, banner flow and `ApiBaseUrl = SiteUrl` cover all screens in the refined mockups? | contracts C-02, C-04; `inception/refined-mockups/` | [ ] |
| Async/monitoring (C6) | Are the scheduler, queue message, DLQ, alarms and 401/403 metric filters clear? | contracts C-05, C-08; decisions D8, D13 | [ ] |
| Cost | Does the design stay under $30/month and scale to zero? | decisions "Capacity and cost reasoning" | [ ] |
| Security | No secrets in code/outputs/logs; least-privilege IAM; cancel token not leaked on duplicate RSVP | decisions D4, D5; contracts C-01, C-02 | [ ] |
| Operations | Final pipeline never destroys; cleanup and load test are debug-only | decisions D9, D11; contracts C-08 | [ ] |

## Component sequencing

| Component | Prerequisite |
|---|---|---|
| C1 Foundation | Initial platform component |
| C2 CI/CD | C1 stack and deployment outputs |
| C3 Event APIs | C1 stack and shared data model |
| C6 Async + monitoring | C1 stack and operational signals |
| C4 UI | C3 API contracts; mock-based work can start earlier |
| C5 Reminders/Statistics/Archival | C3 data model and C6 messaging infrastructure |
| C7 Evidence and release | Deployed C1–C6 components |

AI-DLC changes should follow the active workflow gates and be made by the
current maintainer or an explicitly assigned contributor.

## Known follow-ups (non-blocking)

- Contract-design review note: the C-06 summary table in the AI-DLC artifact lists only C7 as consumer; the pipeline (C2) is also an invoker. Corrected in `docs/contracts.md`.
