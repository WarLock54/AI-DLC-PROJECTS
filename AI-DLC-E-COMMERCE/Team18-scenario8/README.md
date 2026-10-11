# Project Education for DevOps — AI-Assisted Scenarios

A collection of hands-on scenarios for DevOps teams to build and deploy real applications on cloud infrastructure using AI-driven development (AIDLC methodology). Available for **AWS**, **Azure**, and **GCP**.

## What Is This

This is a practical assessment module for DevOps courses. After completing the core curriculum, student teams receive a scenario — a realistic application with functional requirements and infrastructure expectations — and must design, build, and deploy it on a cloud platform **with AI assistance**.

The key twist: AI helps with implementation, but **students must understand and justify every decision**. A verification agent then examines the deployment and conducts an interview focused on *why*, not *how*.

> 🎯 **DevOps Focus**: This project is about **infrastructure, not application code**. Front-end and back-end components should be replaced with stubs, mocks, or minimal implementations — just enough to validate the infrastructure works. Your time and effort should go into IaC, CI/CD, networking, security, monitoring, and operational decisions.

> 💼 **Interview Preparation**: Think of this as practice for a real technical interview or solution discussion with a customer. You are expected to present architecture options, justify trade-offs, and defend your decisions — the same skills assessed when discussing cloud solutions with stakeholders or during DevOps/Cloud engineer interviews.

## How It Works

```mermaid
graph TB
    subgraph "📋 Setup"
        B[Team receives SCENARIO.md and profile<br/>+ aidlc-prompt.md in prepared repo]
    end

    subgraph "🔨 Student Development Process"
        B --> C[Configure AIDLC workflow<br/>in coding agent]
        C --> D[Feed aidlc-prompt.md<br/>into AI agent ]
        D --> E["🔵 INCEPTION PHASE<br/>AI asks clarifying questions<br/>Team makes architecture decisions (depth depends on profile)"]
        E --> F["🟢 CONSTRUCTION PHASE<br/>AI generates code + IaC<br/>Team reviews and approves (depth depends on profile)"]
        F --> G["🟡 OPERATIONS PHASE<br/>Deploy to cloud account<br/>Set up CI/CD + monitoring (may be skipped)"]
        G --> H{Does it work?}
        H -- No --> I[Debug and iterate<br/>with AI assistance]
        I --> F
        H -- Yes --> J[✅ Deployment complete<br/>Push to repository]
    end

    subgraph "🔍 Verification Process"
        J --> K[Evaluator opens repo in Kiro<br/>+ authenticates to cloud account]
        K --> L[Invoke Verification Agent]
        L --> M["Phase 1: Automated Discovery<br/>Scan repo + query cloud APIs"]
        M --> N["Phase 2: Completeness Check<br/>Verify requirements vs deployment"]
        N --> O["Phase 3: Understanding Interview<br/>Generate WHY questions"]
        O --> P["📝 Evaluation Report<br/>Scores + interview questions"]
    end

    subgraph "🟣 AI Pre-Assessment"
        P --> J2["Student conducts live AI interview<br/>with verification agent"]
    end

    style E fill:#dbeafe,stroke:#3b82f6
    style F fill:#dcfce7,stroke:#22c55e
    style G fill:#fef9c3,stroke:#eab308
    style J2 fill:#fce7f3,stroke:#ec4899
    style M fill:#f3e8ff,stroke:#a855f7
    style N fill:#f3e8ff,stroke:#a855f7
    style O fill:#f3e8ff,stroke:#a855f7
```

## Student Workflow — Step by Step

```mermaid
sequenceDiagram
    participant S as Student Team
    participant AI as AI Agent (AIDLC)
    participant Cloud as Cloud Account

    S->>AI: Feed aidlc-prompt.md
    AI->>S: Clarifying questions (requirements, constraints)
    S->>AI: Answers + architecture preferences

    rect rgb(219, 234, 254)
        Note over S,AI: 🔵 Inception Phase
        AI->>S: Proposed architecture + service choices
        S->>AI: Review, adjust, approve
        AI->>S: Execution plan with units of work
    end

    S->>S: Commit design docs + open MR → close Inception milestone

    rect rgb(220, 252, 231)
        Note over S,AI: 🟢 Construction Phase
        AI->>S: Application code + IaC definitions
        S->>AI: Review code, request changes
        AI->>S: Tests + CI/CD pipeline config
        S->>AI: Approve final implementation
    end

    S->>S: Commit code + IaC + open MR → close Construction milestone

    rect rgb(254, 249, 195)
        Note over S,Cloud: 🟡 Operations Phase
        S->>Cloud: Deploy infrastructure (IaC)
        S->>Cloud: Deploy application (CI/CD)
        S->>Cloud: Configure monitoring + alerts
        Cloud-->>S: Running application ✅
    end

    S->>S: Commit final state + open MR → close Operations milestone

    rect rgb(252, 231, 243)
        Note over S,AI: 🟣 AI Pre-Assessment
        S->>AI: Run verification agent (agent-prompt.md)
        AI->>S: Hard open WHY questions (live interview)
        S->>AI: Answers in own words — no reading from files
    end
```

## Verification Workflow — How Evaluation Works

For final verification, the instructor-specified git action (for example, a branch push, tag, or merge request) triggers a fresh sandbox deployment and the verification agent checks the live result.

```mermaid
sequenceDiagram
    participant S as Student Team
    participant E as Evaluator
    participant VA as Verification Agent
    participant Repo as Student Repository
    participant Cloud as Cloud Account

    E->>VA: "Review deployment for scenario X"

    rect rgb(243, 232, 255)
        Note over VA,Cloud: Phase 1 — Automated Discovery
        VA->>Repo: Scan IaC, app code, CI/CD config
        VA->>Cloud: Query deployed resources (CLI)
        VA->>Cloud: Check compute, storage, networking
        VA->>Cloud: Check monitoring, security, costs
        VA-->>VA: Map code ↔ deployed resources
    end

    rect rgb(243, 232, 255)
        Note over VA,Cloud: Phase 2 — Completeness Check
        VA->>VA: Compare requirements vs implementation
        VA->>Cloud: Verify resources are running
        VA->>Cloud: Check CI/CD pipeline history
        VA-->>VA: Generate completeness checklist
    end

    rect rgb(243, 232, 255)
        Note over VA,Cloud: Phase 3 — Understanding Interview
        VA->>VA: Analyze architecture decisions
        VA->>VA: Generate tailored WHY questions
        Note right of VA: "Why Fargate over EKS?"<br/>"Why DynamoDB over RDS?"<br/>"What if budget is cut 50%?"
    end

    VA-->>E: 📝 Evaluation Report
    Note over E: Scores, questions,<br/>strengths, improvements

    rect rgb(252, 231, 243)
        Note over S,VA: 🟣 AI Pre-Assessment
        S->>VA: Run verification agent (agent-prompt.md)
        VA-->>S: Hard-mode WHY questions
        S->>VA: Answers in own words — no reading from files
        VA-->>S: Ready for human evaluation ✅
    end

    E->>S: Conduct interview using<br/>generated questions
    S->>E: Justify decisions
    E->>E: Adjust final scores<br/>based on understanding
```

## Scenarios Overview

Each scenario is a realistic application that requires teams to make meaningful infrastructure decisions. The same 10 scenarios are available for all three cloud providers, adapted to each platform's native services.

```mermaid
graph LR
    subgraph "10 Scenarios"
        S1["🎪 Community Event Board<br/><i>Content platform</i>"]
        S2["🚛 Fleet Telemetry Ingestion<br/><i>IoT / streaming</i>"]
        S3["💳 Multi-Tenant SaaS Billing<br/><i>FinTech / SaaS</i>"]
        S4["🖼️ Image Processing Pipeline<br/><i>Media processing</i>"]
        S5["🧑‍💻 Internal Developer Portal<br/><i>Platform engineering</i>"]
        S6["💬 Real-Time Chat System<br/><i>Communication</i>"]
        S7["🛡️ Compliance Reporter<br/><i>Security / governance</i>"]
        S8["🛒 E-Commerce Product Catalog<br/><i>Retail</i>"]
        S9["🔄 CI/CD Microservices Platform<br/><i>DevOps tooling</i>"]
        S10["🔥 DR Drill Simulator<br/><i>Reliability engineering</i>"]
    end

    S1 --- AWS
    S1 --- Azure
    S1 --- GCP

    subgraph "Cloud Providers"
        AWS["☁️ AWS<br/><i>scenarios-aws/</i>"]
        Azure["☁️ Azure<br/><i>scenarios-azure/</i>"]
        GCP["☁️ GCP<br/><i>scenarios-gcp/</i>"]
    end
```

| # | Scenario | Domain | What Students Decide |
|---|----------|--------|---------------------|
| 1 | **Community Event Board** | Content platform | Compute model, data storage, CDN, async email delivery |
| 2 | **Fleet Telemetry Ingestion** | IoT / streaming | Ingestion protocol, stream processing, time-series storage |
| 3 | **Multi-Tenant SaaS Billing API** | FinTech / SaaS | Data isolation strategy, API management, async billing |
| 4 | **Image Processing Pipeline** | Media processing | Object storage, processing compute scaling, queue orchestration |
| 5 | **Internal Developer Portal** | Platform engineering | Container orchestration, search engine, SSO integration |
| 6 | **Real-Time Chat System** | Communication | WebSocket management, pub/sub, message persistence |
| 7 | **Scheduled Compliance Reporter** | Security / governance | Cross-account scanning, scheduled compute, alerting |
| 8 | **E-Commerce Product Catalog** | Retail | Database + search engine, caching strategy, traffic scaling |
| 9 | **CI/CD Platform for Microservices** | DevOps tooling | Pipeline orchestration, artifact management, env isolation |
| 10 | **Disaster Recovery Drill Simulator** | Reliability engineering | Multi-region architecture, backup validation, DNS failover |

## Evaluation Criteria

```mermaid
pie title Evaluation Weight Distribution
    "Functionality" : 25
    "Infrastructure Design" : 25
    "Cost Efficiency" : 15
    "Security Posture" : 15
    "Operational Readiness" : 10
    "CI/CD Pipeline" : 10
```

| Dimension | Weight | What Is Assessed |
|-----------|--------|-----------------|
| **Functionality** | 25% | Does the application work as described in the scenario? |
| **Infrastructure Design** | 25% | Are service choices appropriate and well-justified? |
| **Cost Efficiency** | 15% | Is the deployment cost-conscious for the workload? |
| **Security Posture** | 15% | Least privilege, secrets management, network isolation |
| **Operational Readiness** | 10% | Monitoring, logging, alerting, incident response readiness |
| **CI/CD Pipeline** | 10% | Automated build → test → deploy flow |

The verification agent asks **why, not how**. A well-justified unconventional choice scores higher than an unjustified conventional one.

## Final Demo Presentation

Each team must deliver a **live demo presentation** to a panel of human experts. This is a mandatory part of the evaluation process.

### Requirements

| # | Requirement | Details |
|---|-------------|---------|
| 1 | **Live Demo** | The presentation must include a live demonstration of the deployed, working application — not screenshots or recordings. The system must be running in the cloud and demonstrated in real time. |
| 2 | **Architecture Diagram** | The presentation **must** include a manually created architecture diagram using official cloud provider icons and symbols. Auto-generated diagrams (e.g., from IaC tools) are **not accepted**. |
| 3 | **Time Limit** | Strict **10-minute** maximum. Presentations exceeding the time limit will be stopped. |

### Architecture Diagram Guidelines

The architecture diagram must be created by the team (not auto-generated) and use official brand icons:

- **AWS**: [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) — reference examples at [AWS Reference Architecture Diagrams](https://aws.amazon.com/architecture/reference-architecture-diagrams/)
- **Azure**: [Azure Architecture Icons](https://learn.microsoft.com/en-us/azure/architecture/icons/)
- **GCP**: [Google Cloud Architecture Icons](https://cloud.google.com/icons)

The diagram should clearly show:
- All major services/resources used and their relationships
- Data flow between components
- Network boundaries (VPCs, subnets, security groups)
- External integrations and user entry points

> ⚠️ **The diagram demonstrates that the team understands the architecture they built — not just that they can deploy code generated by AI.**

### Suggested Demo Structure (10 min)

| Time | Section |
|------|---------|
| 0:00–2:00 | Architecture overview using the diagram |
| 2:00–7:00 | Live demo of the running application |
| 7:00–9:00 | Key decisions and trade-offs |
| 9:00–10:00 | Summary and lessons learned |

## Repository Structure

```
├── README.md                          ← you are here
├── AGENTS.md                          ← canonical guidance for any AI agent
├── CLAUDE.md                          ← pointer to AGENTS.md
├── SETUP.md
├── VERIFICATION.md
├── VERIFICATION-PLAN.md
├── agents-install/
│   └── KIRO.md
├── scenarios-aws/
│   ├── README.md
│   ├── aws-budget-guide.md
│   ├── scenario-01-community-event-board/
│   │   ├── SCENARIO.md
│   │   └── aidlc-prompt.md
│   ├── ... (scenarios 02–10)
│   └── verification-agent/
│       ├── README.md
│       ├── agent-prompt.md
│       └── question-bank.md
├── scenarios-azure/
│   ├── README.md
│   ├── azure-budget-guide.md
│   ├── scenario-01-community-event-board/
│   │   ├── SCENARIO.md
│   │   └── aidlc-prompt.md
│   ├── ... (scenarios 02–10)
│   └── verification-agent/
│       ├── README.md
│       ├── agent-prompt.md
│       └── question-bank.md
└── scenarios-gcp/
    ├── README.md
    ├── gcp-budget-guide.md
    ├── scenario-01-community-event-board/
    │   ├── SCENARIO.md
    │   └── aidlc-prompt.md
    ├── ... (scenarios 02–10)
    └── verification-agent/
        ├── README.md
        ├── agent-prompt.md
        └── question-bank.md
```

## Auto-Deployment

Deployment happens in two phases, both driven by the same `.gitlab-ci.yml` pipeline in your repository.

See [AUTO-DEPLOY.md](AUTO-DEPLOY.md) for the authoritative deployment phases, required variable names, pipeline rules, and common pitfalls.

---

## Getting Started

### For Instructors

1. Choose the cloud provider for your course (AWS, Azure, or GCP)
2. Assign one scenario per team (10 scenarios for 10 teams)
3. Provide students with the scenario folder and AIDLC setup instructions
4. After deployment, use the verification agent to generate evaluation reports
5. Conduct interviews using the agent-generated questions

### For Students

1. Read your `SCENARIO.md` carefully — understand the functional requirements and infrastructure expectations
2. **Set up GitLab project tracking** — create Milestones (Inception / Construction / Operations) and open your Issue Board before writing a single line of code. See [SETUP.md](SETUP.md) Step 6 for the full workflow.
3. **Install the AI-DLC v2 framework and configure it into your repo** ([Getting Started](https://awslabs.github.io/aidlc-workflows/guide/01-getting-started/)) — install the native `aidlc` command, run `aidlc config --harness <your-harness>` and `aidlc doctor`, then confirm `/aidlc --doctor` passes. This is **mandatory**, not optional. See [SETUP.md](SETUP.md) Step 7 for the full procedure and the scenario→profile mapping.
4. Start the AI-DLC **conductor** with the profile your scenario specifies (its `## AI-DLC Profile` section — `poc`/`mvp`, `feature`, or `enterprise`) and point it at `aidlc-prompt.md` (e.g. `/aidlc <profile> Follow ./aidlc-prompt.md`); as the conductor produces the execution plan, split the work into GitLab Issues and assign each to a team member. The conductor records your decisions in the `aidlc/` workspace — that decision trail is what proves ownership at verification.
5. Work through the phases your profile runs (Inception → Construction, plus Operation for `enterprise` scenarios), closing issues and opening MRs as work completes
6. Deploy to your cloud account — your CI/CD pipeline handles this automatically on every commit to `main`; see [AUTO-DEPLOY.md](AUTO-DEPLOY.md) for what the pipeline must include
7. Be ready to explain **why** you made each architectural decision
8. Prepare your architecture diagram (manually, using official cloud icons) and live demo for the final presentation

> ⚠️ **AIDLC framework installation is required.** The verification agent checks for proper AIDLC setup and generated documentation. Projects without AIDLC workflow configured and phase documents produced will be marked incomplete regardless of deployment quality.

> The framework is required because it produces the **decision trail** (`aidlc-state.md`, `audit.md`, design and requirement docs) that the verification agent uses to generate interview questions about *your* decisions. Without it, there is nothing for the interviewer to ask about, and the project cannot demonstrate ownership.

### Repository Deliverables

The following must be included in the team's repository:

| # | Deliverable | Details |
|---|-------------|---------|
| 1 | **`.gitlab-ci.yml`** | GitLab CI pipeline that deploys all infrastructure and application code automatically on commit to `main` — no manual steps, must exit 0 |
| 2 | **AIDLC decision trail** | The `aidlc/` workspace with `aidlc-state.md`, `audit.md`, and all phase artifacts (inception/construction/operations) produced by the AI-DLC conductor — this is the evidence of ownership |
| 3 | **Architecture diagrams** | `.drawio` files with the architecture diagrams used in the presentation |
| 4 | **PowerPoint presentation** | The final demo presentation. Use a clear, professional template appropriate for your audience. |

### Test Data

Real data is not needed. AI generates realistic seed data, simulators, and load generators as part of the development process. This is part of the exercise — defining what data the system needs and how to simulate it is a design decision.

## Prerequisites

- Completed core DevOps course for the target cloud platform
- Cloud account/subscription/project with appropriate permissions
- CLI configured and authenticated (`aws`, `az`, or `gcloud`)
- AI-DLC v2 framework installed (`aidlc` command) and configured into the project — see [SETUP.md](SETUP.md) Step 7 and [Getting Started](https://awslabs.github.io/aidlc-workflows/guide/01-getting-started/)
- Familiarity with at least one IaC tool (Terraform, CloudFormation/CDK, Bicep, or Deployment Manager)

## License

Educational use. See individual cloud provider folders for detailed documentation.
