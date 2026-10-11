# Setup

## Prerequisites

Read and get familiar with the AI-DLC method and its v2 framework:

- [AI-Driven Development Life Cycle: Reimagining Software Engineering](https://aws.amazon.com/ru/blogs/devops/ai-driven-development-life-cycle/) — the methodology
- [AI-DLC Workflows — Getting Started](https://awslabs.github.io/aidlc-workflows/guide/01-getting-started/) — the **v2 native framework** you must install
- [Workflow Profiles](https://awslabs.github.io/aidlc-workflows/guide/workflow-profiles/) — the profiles and the three depth levels

> 🛑 **AI-DLC v2 is a required, installed toolchain.** You must install the native `aidlc` command and configure it into this repository (Step 7). "I let my AI follow the phases from the docs" is **not** an accepted substitute — it produces none of the framework artifacts the verification agent checks for, and the project will be marked incomplete.

Use one AI-enabled harness supported by AI-DLC v2 (install and authenticate the harness first, then configure AI-DLC into the project):

- **Kiro CLI ≥ 2.6** (`aidlc config --harness kiro`) — see [Kiro setup](agents-install/KIRO.md)
- **Kiro IDE** (`aidlc config --harness kiro-ide`)
- **Claude Code** (`aidlc config --harness claude`)
- **OpenAI Codex CLI ≥ 0.145** (`aidlc config --harness codex`)
- **Cursor** (`aidlc config --harness cursor`)
- **opencode ≥ 1.17** (`aidlc config --harness opencode`)
- **GitHub Copilot** (`aidlc config --harness copilot`)

See the [harness guides](https://awslabs.github.io/aidlc-workflows/guide/harnesses/) for the per-harness first-run requirements.

You also need a working cloud account or a temporary sandbox.

## Installation

### Step 1: Repository Is Already Prepared

This repository was provisioned for your team by the orchestrator before you received access.

It is prepared for:

- One cloud provider (AWS, Azure, or GCP)
- One scenario
- Your current team membership

### Step 2: Confirm the Provisioned Repository

The preparation flow is idempotent:

- If your team did not have a repository for that cloud and scenario, a new one was created
- If your team already had one, it was reused and returned

This prevents duplicate projects and keeps your team in a single working repository.

### Step 3: Verify You Opened the Correct Repository

Use the repository URL shared with your team after preparation. The project is already configured under the correct group naming convention for the selected cloud/scenario.

### Step 4: Verify the Prepared Content

The repository is pre-filtered to the chosen cloud and scenario so AI context stays focused. You do not need to fork, detach, or manually delete unrelated scenario folders.

### Step 5: Clone Your Project

Clone the prepared repository to your local environment.

After preparation, your repository should look similar to this:

```text
.
├── README.md
├── SETUP.md
├── VERIFICATION.md
├── agents-install/
│   └── KIRO.md
├── aidlc/                    # AI-DLC workspace — created by `aidlc config` in Step 7
├── scenarios-aws/            # or scenarios-azure / scenarios-gcp
│   ├── README.md
│   ├── <selected-scenario>/
│   │   ├── SCENARIO.md
│   │   └── aidlc-prompt.md
│   └── verification-agent/
└── (other top-level files as needed)
```

> The `aidlc/` directory does not exist yet at clone time — it is created when you run `aidlc config` in Step 7. If your harness uses a different docs root (`_aidlc/`, `aidlc-docs/`, or `.aidlc/`), that is fine; the verification agent accepts any of them.

### Step 6: Set Up GitLab Project Tracking

Configure GitLab project management before starting any development work. This is mandatory — the verification agent checks for it.

GitLab Issues are how your team divides and owns the work. AIDLC drives the technical process, but within each phase the team must split responsibilities — who sets up networking, who writes the IaC, who configures CI/CD, who handles monitoring. Issues make that split explicit and visible.

1. **Create one Milestone per AIDLC phase that your run actually executes** (Issues > Milestones). Each milestone marks the completion of that phase.

   AI-DLC v2 organizes work into up to **five sequential phases** — `Initialization`, `Ideation`, `Inception`, `Construction`, `Operation` — but **the workflow profile (scope) you pick decides which phases and stages actually run**, so the phase count varies per run. Do **not** assume a fixed set. Two of these phases are commonly skipped:

   - **`Initialization`** (stages 0.1–0.3) auto-proceeds silently with no approval gate. It is framework bookkeeping — **never create a milestone for it.**
   - **`Ideation`** (intent, market research, feasibility, scope discovery) is meant for *unclear* problems. In this course the problem is **already fully specified** in your `SCENARIO.md` and `aidlc-prompt.md`, so the lighter profiles skip it: the M1 **`poc`/`mvp`** profiles reduce Ideation ceremony and the M2 **`classic`** profile starts directly at Inception (no Ideation); only the M3/M4 **`enterprise`** profile runs the full Ideation phase. Add an Ideation milestone only if your scenario's profile (Step 7.4) actually runs it.

   That leaves the phases you will usually track as milestones:

   - `Inception` — closes when requirements, architecture/domain design, and the delivery plan are agreed and documented (Verification Gate: Inception → Construction).
   - `Construction` — closes when code + IaC are generated, built/tested, and the CI pipeline is in place (Verification Gate: Construction → Operation).
   - `Operation` — closes when the application is deployed, CI/CD is running, and monitoring is in place. **Skipped by the M1 `poc`/`mvp` profiles**, and only *basic* deploy is expected for the M2 `classic` profile — the full Operation phase (4.1–4.7) is required for the M3/M4 **`enterprise`** scenarios. If your run skips it, do not create this milestone.

   > The milestone set therefore follows your scenario's profile (Step 7.4): M1 (`poc`/`mvp`) is typically **Inception → Construction**; M2 (`classic`) is **Inception → Construction** with a basic-deploy Operation; M3/M4 (`enterprise`) is the full **Inception → Construction → Operation** (plus Ideation).

   **Confirm your phases, don't guess.** After you start the conductor and it confirms a profile (Step 7 / Step 11), run `/aidlc --status` (`$aidlc --status` on Codex CLI). It reports the phases and stages your scope will execute. Create your milestones to mirror exactly that list.

2. **Create GitLab Issues for each piece of work a team member owns.** When AIDLC produces its delivery/execution plan (end of Inception — the "Units of work" and delivery-planning artifacts), split the resulting work items into issues and assign each to a specific person. One issue = one clear owner. Add every issue to the relevant phase milestone so the board shows who is doing what across the whole phase.

3. **Keep the Issue Board current.** Move issues to *In Progress* when started and close them when done. If work shifts between team members, reassign the issue — do not leave it unassigned or assigned to the wrong person. The board should always show the real state of delegation, not the original plan.

4. **Use Merge Requests for every meaningful change.** Each issue should result in one or more MRs from a feature branch into `main`. Reference the issue in the MR description so it closes automatically on merge. MRs are not tied one-to-one to milestones — a single milestone contains many MRs. A milestone closes when all its issues are resolved. Do not fast-forward — the MR history is a required deliverable.

### Step 7: Install the AI-DLC Framework (MANDATORY — DO NOT SKIP)

> 🛑 **This is a hard prerequisite, not a suggestion.** This project is graded on running the **AI-DLC v2 framework**, not on an AI "following the steps" from memory. A general-purpose AI reading these Markdown files can *imitate* the phases, but it **cannot** produce the `aidlc/` workspace, the `aidlc-state.md` state file, the audit trail, or the per-stage artifacts that the framework generates. The verification agent checks for exactly those framework-generated files (see [VERIFICATION.md](VERIFICATION.md) and `verification-agent/`). **No `aidlc/` workspace + audit trail = the project is marked incomplete, regardless of how good the deployment looks.**

AI-DLC v2 is a native, installed toolchain — **not** a set of prompts you copy into a chat. You install a real `aidlc` command, configure it into this repository for your chosen harness (AI agent), and then drive every phase through the `/aidlc` conductor.

#### 7.1 — Install the native `aidlc` runtime

macOS / Linux / WSL:

```bash
curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex
```

The installer adds the `aidlc` command and every harness runtime (no Bun/Node/Git required). If a new shell cannot find `aidlc`, apply the `PATH` line the installer prints. Verify:

```bash
aidlc --version
```

#### 7.2 — Configure AI-DLC into THIS repository

Run from the repository root (the folder containing this `SETUP.md`). Pick the value that matches your harness:

```bash
cd /path/to/your-project
aidlc config --harness kiro     # kiro | kiro-ide | claude | codex | cursor | opencode | copilot
aidlc doctor
```

`aidlc config` creates the harness integration **plus the `aidlc/` workspace** (a sibling of `.kiro/`). `aidlc doctor` must report no blocking problems before you continue. If you use Kiro CLI, you also need **Kiro CLI ≥ 2.6** logged in (`kiro-cli login`); see [Kiro setup](agents-install/KIRO.md).

> If `aidlc doctor` reports a missing workspace shell or an unconfigured harness, **stop and fix it here.** Do not start the scenario. Every later step assumes a healthy install.

> ⚠️ **Keep Claude Code model-provider credentials separate from deployment credentials.** If you use Amazon Bedrock, configure a dedicated AWS profile for it rather than reusing the default profile used by deployment commands. Otherwise, model requests and cloud operations may run with the wrong account or fail when deployment credentials change. See the [Claude Code Bedrock guide](https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock) and use a provider supported by your harness.

AI-DLC audit records are part of the project history; do not rewrite past entries to change attribution. If preparing a personal or public repository and existing team history should not be shared, retain a private backup and start a separate solo intent rather than editing the historical audit trail.

#### 7.3 — Confirm the conductor is live

Open your harness in the project and run the built-in doctor from inside the session:

- Kiro CLI: `kiro-cli chat` then `/aidlc --doctor`
- Claude Code / Kiro IDE / Cursor / opencode / Copilot: open the project, then `/aidlc --doctor`
- Codex CLI: `codex`, then `$aidlc --doctor`

You should get a clean status and a "workspace shell ready" check. `/aidlc --status` should report a position (no active workflow yet is fine). **If `/aidlc` is not a recognized command, the framework is not installed — return to 7.1.**

#### 7.4 — Choose the workflow profile that matches YOUR scenario

AI-DLC v2 sizes each run with a **workflow profile** (the engine calls it the **scope**). The profile decides which of the five phases and 33 stages actually execute, and at what depth. **The profile is not free choice — it is tied to your assigned scenario and course module.** Using the wrong profile (e.g. `poc` on an enterprise scenario) is a verification finding: the run will be missing the phases, gates, and artifacts the scenario expects.

Each scenario states its expected profile at the top of its `SCENARIO.md` (the **AI-DLC Profile** line). Look up your assigned scenario below, then use the matching profile:

| # | Scenario | Module / Track | Profile to use |
|---|----------|----------------|----------------|
| 1 | Community Event Board | M1 — Express | **`poc`** or **`mvp`** |
| 2 | Fleet Telemetry Ingestion | M2 — Classic | **`classic`** |
| 3 | Multi-Tenant SaaS Billing API | M4 — Graduation | **`enterprise`** |
| 4 | Image Processing Pipeline | M3 — Enterprise | **`enterprise`** |
| 5 | Internal Developer Portal | M1 — Express | **`poc`** or **`mvp`** |
| 6 | Real-Time Chat System | M2 — Classic | **`classic`** |
| 7 | Scheduled Compliance Reporter | M3 — Enterprise | **`enterprise`** |
| 8 | E-Commerce Product Catalog | M2 — Classic | **`classic`** |
| 9 | CI/CD Microservices Platform | M3 — Enterprise | **`enterprise`** |
| 10 | Disaster Recovery Simulator | M4 — Graduation | **`enterprise`** |

The canonical mapping, grouped by module with the depth and stage plan each profile runs:

| Scenarios | Module / Track | Profile to use | Depth | What runs |
|-----------|----------------|----------------|-------|-----------|
| **#1** Community Event Board, **#5** Internal Developer Portal | M1 — Express | **`poc`** or **`mvp`** | Minimal | Fast design → build → demo. `poc` reduces Inception and skips Operation; `mvp` keeps full design/build but still skips the Operation phase. |
| **#2** Fleet Telemetry, **#6** Real-Time Chat, **#8** E-Commerce Catalog | M2 — Classic | **`classic`** | Standard | Established lifecycle starting at Inception (no Ideation), through Construction and applicable Operation stages; every standard stage runs. Basic deploy expected, full Operation phase not required. |
| **#4** Image Processing, **#7** Compliance Reporter, **#9** CI/CD Platform | M3 — Enterprise | **`enterprise`** | Comprehensive | All 33 stages, all five phases, all gates with documented evidence, full artifact set. |

> **Module 4 (Graduation) scenarios #3 Multi-Tenant Billing and #10 DR Simulator** are the capstone and are **not** pinned to a fixed profile here: they run the full **`enterprise`** scope (greenfield or brownfield), and any alternative scenario must be approved by your instructor and must exercise the full Operation phase. Confirm the exact scope with your instructor.

Start the workflow with the profile your scenario names, pointing at the `aidlc-prompt.md` **inside your scenario directory** (`scenarios-<cloud>/<selected-scenario>/aidlc-prompt.md`), not one at the repo root:

```bash
# Replace the path with your cloud + scenario, e.g. scenarios-aws/scenario-02-fleet-telemetry-ingestion/
/aidlc poc Follow ./scenarios-aws/<selected-scenario>/aidlc-prompt.md         # M1 scenarios (#1, #5)
/aidlc classic Follow ./scenarios-aws/<selected-scenario>/aidlc-prompt.md     # M2 scenarios (#2, #6, #8)
/aidlc enterprise Follow ./scenarios-aws/<selected-scenario>/aidlc-prompt.md  # M3 scenarios (#4, #7, #9) and M4 (#3, #10)
```

You can fine-tune with `--depth minimal|standard|comprehensive`, but do not use it to turn one profile into another — pick the profile that matches your scenario first. If unsure, run `/aidlc --status` after the conductor confirms the scope and check the phase/stage plan against the table above.

> ✅ **Definition of done for Step 7:** `aidlc --version` works, `aidlc doctor` is clean, an `aidlc/` directory exists in the repo, and `/aidlc --doctor` passes inside your harness. Only then proceed to Step 8.

### Step 8: Configure GitLab CI/CD Variables

The orchestrator authenticates to the cloud using GitLab CI/CD variables in your project. During debugging you create these variables yourself with the sandbox credentials you receive; during the final check the orchestrator overwrites the same variables with a fresh sandbox — which is why the names must be **exactly** right.

Go to **Settings → CI/CD → Variables** and create the variables for your cloud provider. The authoritative variable-name tables (AWS / Azure / GCP) and the AWS sandbox limitations (single region, allowed EC2 instance families) live in **[AUTO-DEPLOY.md](AUTO-DEPLOY.md)** — use those exact names; any deviation breaks the final verification.

Never hardcode credentials in code or pipeline files. When a sandbox expires (8 hours), update the variable values with credentials from the next sandbox.

For local development, also configure your local CLI (`aws configure`, `az login`, `gcloud auth`) with the same sandbox credentials so your AI agent can run commands directly.

> ⚠️ **Keep AI model-provider credentials separate from cloud deployment credentials.** If the AI agent uses AWS Bedrock, configure a dedicated AWS profile for it; do not reuse the default profile used by deployment commands.

### Step 9: Build and Debug with the Sandbox

The orchestrator provides 8-hour sandbox accounts for iterative development. Set the credentials in your CI/CD variables (Step 8), implement your scenario through the AIDLC phases, deploy via your `.gitlab-ci.yml` (or locally with IaC CLI commands), and test against the running deployment. When a sandbox expires, request a new one, update your variables, and continue — until the pipeline exits 0 consistently.

Your `.gitlab-ci.yml` must deploy everything automatically on every commit to `main` — no manual steps, idempotent, exit 0 only when the app is up. **[AUTO-DEPLOY.md](AUTO-DEPLOY.md)** is the authoritative reference for the debug/verification phases, pipeline requirements, Terraform remote state, what is not allowed, and common pitfalls.

### Step 10: Trigger the Final Check

When your pipeline reliably exits 0 and the application runs correctly:

1. Make sure your final working state is committed and pushed to `main`
2. Perform the git action your instructor specified (tag, MR, or branch push — confirm with them)
3. The orchestrator provisions a clean sandbox, overwrites your CI/CD variables with its credentials, and runs your pipeline automatically — you have no access to this sandbox
4. Monitor your GitLab pipeline; if it exits 0, the AI verification agent runs on the external system

Do not push any further changes after triggering the final check. See **[AUTO-DEPLOY.md](AUTO-DEPLOY.md)** Phase 2 for details.

### Step 11: Start the Scenario

Read your SCENARIO.md to understand the requirements **and the AI-DLC Profile it specifies** (see Step 7.4). Then start the AI-DLC **conductor** (not a plain chat) with that profile and point it at your scenario's `aidlc-prompt.md`. `aidlc-prompt.md` is the intent you feed the conductor; it opens with a preflight gate that makes the agent refuse to proceed unless the AI-DLC framework from Step 7 is installed and running.

Example (Kiro CLI) — replace `<profile>` with the one your scenario names (`poc`/`mvp`, `feature`, or `enterprise`):

```bash
kiro-cli chat
/aidlc <profile> Follow the intent and preflight gate in ./scenarios-aws/<selected-scenario>/aidlc-prompt.md for this scenario
```

(Use the invocation for your harness: `/aidlc` for most, `$aidlc` for Codex CLI.)

Answer the conductor's clarifying questions, approve each phase gate, and let it generate the decision trail and stage artifacts in the `aidlc/` workspace. **This is the point of the exercise:** every architecture choice becomes a decision *you* made and recorded, so you can defend it later. You must understand what the AI does and *why* — the verification agent interviews you on your own recorded decisions, and you cannot pass by reading generated files aloud. See [VERIFICATION.md](VERIFICATION.md).

**Important:**
- Do not edit or remove the preflight gate at the top of `aidlc-prompt.md`. If your agent skips it or says it "cannot run `/aidlc`," the framework is not installed — return to Step 7. Do not let the agent proceed on general knowledge alone; a run with no `aidlc/` decision trail cannot demonstrate ownership and will not pass.
- At every gate, make the conductor record *why* you chose an option, *which alternatives you rejected*, and *what you would change under a tighter constraint*. That recorded rationale is exactly what the interview assesses.