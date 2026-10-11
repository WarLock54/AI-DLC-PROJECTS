# Work Verification

## Automated Deployment Check

Before any AI or human evaluation takes place, your project goes through **automated deployment verification**.

When you trigger the final check (via the git action your instructor specified), the orchestrator:

1. Provisions a fresh, isolated sandbox — you have no access to it
2. Overwrites your GitLab CI/CD variables with the new sandbox credentials (same variable names you set up during debugging)
3. Triggers your `.gitlab-ci.yml` pipeline on `main`
4. Waits for the pipeline to complete

**Your project is not eligible for evaluation if:**

- The pipeline exits non-zero
- Any deployment step requires manual intervention
- The application is not running after the pipeline completes

If the pipeline exits 0, the AI verification agent runs automatically on the external system. You do not need to do anything at that point.

Resolve any pipeline failures using the debug sandbox before triggering the final check. See [AUTO-DEPLOY.md](AUTO-DEPLOY.md) for pipeline requirements and variable naming rules.

---

## AI Agent — There to Help

After successful AI interaction you should have a pack of document files, source code, and deployed infrastructure. You should **own** it. This means you understand how it works and why decisions were made.

To help you understand it — a special AI verification agent is provided in the `verification-agent/` directory. It can investigate deployed infrastructure, your scenario description, and ask you questions to help you deep-dive into your implementation.

## AI Pre-Assessment Phase

Before the final human evaluation, all students must complete a mandatory AI interview with the verification agent. This is not a quiz or a self-check — it is a **real-time, back-and-forth conversation** where the agent plays the role of a technical interviewer and you answer live, just as you would with a human evaluator.

The agent will ask hard, open-ended questions focused on architectural trade-offs and *why* decisions were made — not *how* things were implemented. Expect questions like: "Why did you choose this service over the alternative?", "What would break first under 10× load?", "How would you redesign this if the budget were cut in half?". You must answer in your own words without reading from generated files.

**How to run it:** Start a new chat session with `agent-prompt.md` and answer every question the agent asks as if you are in a real interview. If you can answer 5 questions in a row confidently — you are ready for the human evaluation. If you struggle, use AI tools to investigate your project further and repeat the interview.

Only after passing the AI interview are students ready for the final human evaluation and presentation.

## Final Presentation

When you are confident about your project understanding, you must deliver a **live demo presentation (strict 10-minute limit)** to a panel of human experts. Imagine you are an engineer presenting to a customer CTO, or defending your graduation project. You may use any AI to help prepare the presentation.

Rules of thumb:

- Use a clear, professional presentation template appropriate for your audience
- Keep it short and structured: 10 minutes maximum, one clear message per slide
- Start with task definition: scenario goal, business problem, key non-functional requirements, budget and platform constraints
- Show what was implemented versus scenario requirements, so the listener can quickly see that the requested scope is covered
- Explain the final architecture first, then go deeper only into the parts where your decisions matter most
- Focus on why, not only how: explain why you selected these services, tools, and deployment approach over realistic alternatives
- Call out the main trade-offs you accepted: cost vs reliability, speed vs complexity, managed service vs self-managed, single-region vs multi-region, etc.
- Clear diagrams (architectural, data-flow, network, etc.) are necessary; choose only diagrams that help explain an important decision or flow
- Use draw.io with AWS/Azure/GCP standard icons, symbols, and images. Check provider documentation for diagram examples
- Include at least these visuals when relevant: high-level architecture, request/data flow, deployment pipeline, network/security boundaries
- Make diagrams readable in presentation mode: few elements per slide, visible labels, arrows with direction, highlighted critical path
- Show deployed reality, not only design intent: environments, main cloud resources, endpoints, CI/CD pipeline, monitoring or alerting, and evidence that it works
- Present one or two important implementation details that prove ownership: for example IaC structure, scaling approach, secret flow, rollback strategy, or data model
- Cover security decisions briefly: identity/access model, secret management, network exposure, encryption, least-privilege choices
- Cover operational readiness briefly: logs, metrics, alerts, dashboards, failure handling, rollback or recovery approach
- Cover cost awareness briefly: top cost drivers, why they are acceptable, what was optimized, and what you would change under tighter budget
- Display results with evidence: live demo of the running application, deployed URLs, pipeline run, monitoring screenshot, performance or reliability outcome
- End with a short summary: what problem was solved, why this architecture is reasonable, current limitations, and next improvements if project continues
- Be ready to defend every major choice with concrete reasoning, because verification questions will focus on decision rationale

## Presentation Questions

After the presentation you will be asked questions by instructors — similar to what the AI verification agent asks during the preparation phase. The main decision on your success will be based on your **project ownership**.

Ownership means you can explain your project without reading generated files line by line or repeating generic AI answers. In practice, you should be able to:

- Explain the goal of the solution, major requirements, and constraints
- Describe the final architecture and role of each main component
- Justify why specific cloud services, tools, and patterns were chosen over alternatives
- Explain important trade-offs in cost, reliability, scalability, security, and delivery speed
- Show how the solution is deployed, how CI/CD works, and how changes are rolled back
- Explain where secrets are stored, how access is controlled, and how network exposure is limited
- Describe how logs, metrics, alerts, and dashboards help you operate and debug the system
- Walk through the main data flow and failure scenarios end to end
- Identify current limitations, known risks, and what you would improve next
- Defend cost assumptions and name the main cost drivers in the deployed solution

If you cannot explain these points clearly, it usually means the project is not fully owned yet and you need one more investigation pass before the presentation.
