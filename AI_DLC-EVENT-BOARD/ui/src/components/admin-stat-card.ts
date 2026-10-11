// AdminStatCard: one labelled statistic; the heading precedes its textual value.
import { el, type Child } from "../dom.js";

export function createAdminStatCard(label: string, testid: string, content: Child): HTMLElement {
  const headingId = `${testid}-heading`;
  return el(
    "section",
    { testid, className: "card stat-card", attrs: { "aria-labelledby": headingId } },
    [el("h2", { text: label, attrs: { id: headingId } }), content],
  );
}

export function statValue(value: number): HTMLParagraphElement {
  return el("p", { text: value.toLocaleString(), className: "stat-value" });
}
