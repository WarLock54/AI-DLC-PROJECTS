# AI-DLC shared Unit Progress repair

The shared Unit Progress projection used checkout-scoped receipt filtering.
When a checkout was bound to C5, the projection discarded C1–C4 and C6 receipts
and persisted empty cells for those units. Their audit approvals were not lost.
Committing that projection also caused dependency checks to treat completed units
as pending. Changing checkboxes or recompiling the stage graph did not fix it.

The local framework patch confines an all-unit receipt read to the synchronous
shared projection, retaining claim-generation checks. Normal lifecycle reads
still enforce the claimed-unit boundary. The team board derives dependency
availability from the same projection as its grid. The source dispatcher also
registers the existing internal progress-refresh commands. Claim eligibility
reads completion and gate evidence from the fetched integration commit's audit
shards instead of trusting that commit's possibly damaged table. Local, unmerged
receipts cannot unlock a claim. The Plan Approval hook permits exact diagnostic
commands while retaining checks for generation and compound shell mutations.

## Running the patched engine

Native AI-DLC binaries embed their engine code; editing `.claude/tools` does not
patch those binaries. Run the project source dispatcher with Bun:

```sh
sh scripts/aidlc-local engine status
sh scripts/aidlc-local engine orchestrate next --resume
bun test ./.claude/tools/tests/team-progress.test.ts
```

To make ordinary terminal commands use that same engine:

```sh
python3 scripts/install-aidlc-local.py
aidlc --status
aidlc --resume
```

The installer requires Bun and an existing `~/.local/bin/aidlc` installation.
Use `--print` to review its launcher without changing anything.
On the repaired machine, the user-level launcher forwards workflow commands,
including **both `--status` and `--resume`**, plus `engine` and `unit`, to this
source dispatcher only inside this checkout. The first override omitted those
root aliases, leaving the terminal commands on the defective compiled engine.
Commands
outside the project and machine management commands retain the original native
launcher. Its backup is beside it, named `aidlc.native-before-team-progress`.
Other teammates must use the source dispatcher or install an equivalent local
override after receiving this patch. Framework refreshes may overwrite the patch;
retain these changes until an upstream release includes a verified fix.
Before replacing the framework installation, restore the backed-up native launcher;
the native installer rejects a launcher it does not own. This is a project-local
hotfix, not an upstream binary release. Keep the source changes on any branch
where this workflow is resumed.

## Verification and scope

The regression uses a temporary copy of this project's recorded audit history.
It verifies C1–C6 remain complete, C7 remains pending and available, repeated reads
are stable, missing completion/approval evidence cannot be replaced with checked
cells, and stale-generation and foreign-unit execution checks remain intact.
No completion events, approvals, or guard settings are fabricated or changed.

On 2026-10-06, the actual `aidlc --status` / `aidlc --resume` commands passed
three consecutive cycles: all six completed units remained checked, status left
the saved state byte-identical, and resume (after its steering continuation)
returned `run-stage` for `c7-evidence-release`. The C7 claim was created through
`aidlc --claim` against the integration commit, with the old C5 binding backed up.

A checkout's selected unit is separate from the shared table. Moving from C5 to
C7 still requires a valid C7 claim/binding. This patch does not grant a claim,
publish a candidate, approve a merge, or run C7's implementation.

## Unit start immediately disappears after Request Changes

The attempt-floor reader treated any explicitly supplied audit rows as already
sorted. `readAuditShardEvents` returns rows grouped by shard, so the lifecycle
reader could select an old jump from another shard while the start writer used
the latest gate rejection. The freshly written start then failed its own floor
comparison, producing "no unit is active" on both complete and pause.

Attempt-floor calculation now always sorts the relevant boundary rows by time
and shard append order. Same-second cross-shard ambiguity and stale-receipt
rejection remain enforced. Regression coverage exercises start, completion,
stale receipts and tied boundaries with deliberately shuffled audit rows.

After this repair, C7's existing start was recognized without adding a new one.
The engine accepted `unit complete` and `orchestrate report --result revised`.
Resume now returns C7 with `gate_only: true`; the person's final approval and
review-finding decisions remain outstanding. No approval was manufactured.

## Saved table remains `?` after approval

The team approval handler appended `GATE_APPROVED` but only updated the state's
timestamp. Live status derived `[x]` from the audit, while the saved table kept
`[?]` until another orchestration pass. The approval transaction now derives and
persists the Unit Progress section immediately after its audit event. It leaves
the stage pointer unchanged. C7's existing approved record was used to regenerate
its saved table; no second approval or stage restart was needed.
