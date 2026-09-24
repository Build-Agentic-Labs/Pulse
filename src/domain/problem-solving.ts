import type { Database } from "@/lib/database.types";

export type ProblemCase = Database["public"]["Tables"]["problem_cases"]["Row"];
export type ProblemAction = Database["public"]["Tables"]["problem_actions"]["Row"];
export type ProblemEvidence = Database["public"]["Tables"]["problem_evidence"]["Row"];
export type ProblemHistory = Database["public"]["Tables"]["problem_history"]["Row"];

export const stages = ["define", "contain", "investigate", "correct", "prevent", "verify", "closed"] as const;
export type Stage = typeof stages[number];
export const stageLabels: Record<string, string> = {
  define: "Define", contain: "Contain", investigate: "Investigate", correct: "Correct",
  prevent: "Prevent", verify: "Verify", closed: "Closed",
};
export const sections = [
  { key: "define", title: "Problem details", guidance: "Describe facts, not assumed causes. Identify where, when and how much of the product or process is affected.", fields: [["problem", "What happened?"], ["expected", "What should have happened?"], ["affected", "Affected units, parts, locations or people"]] },
  { key: "contain", title: "Containment", guidance: "Protect customers and operations now. Record what is isolated, checked or temporarily controlled, then add a containment action below.", fields: [["containment", "Immediate protection and scope"]] },
  { key: "investigate", title: "Root cause and evidence", guidance: "Keep the cause as a hypothesis until it is supported. Ask why repeatedly, test alternatives and explain how the evidence confirms the cause.", fields: [["root_cause", "Suspected / confirmed root cause"], ["cause_evidence", "Evidence supporting the cause and alternatives ruled out"]] },
  { key: "correct", title: "Corrective actions", guidance: "Add actions below that remove the confirmed cause. Each needs an owner, due date and completion evidence.", fields: [] },
  { key: "prevent", title: "Preventive actions", guidance: "Consider similar products and processes. Update standards, training or controls so the same cause cannot recur elsewhere.", fields: [["prevention", "Where else could this happen and what will change?"], ["verification_plan", "Effectiveness check: measure, success criteria and observation period"]] },
  { key: "verify", title: "Effectiveness and closure", guidance: "Check the outcome against the planned criteria after the observation period. Completing work alone is not proof that it worked.", fields: [["verification_result", "Measured results, observation period and evidence of effectiveness"]] },
] as const;
export type NarrativeField = "problem" | "expected" | "affected" | "containment" | "root_cause" | "cause_evidence" | "prevention" | "verification_plan" | "verification_result";
export function caseLabel(number: number) { return `PS-${String(number).padStart(4, "0")}`; }
export function isOverdue(action: ProblemAction, today: string) { return action.status !== "done" && action.due_on < today; }

/** Mirrors the database gate; direct API writes are still validated there. */
export function transitionIssues(c: ProblemCase, actions: ProblemAction[], target: Stage, today: string): string[] {
  const rank = stages.indexOf(target);
  const issues: string[] = [];
  const done = (kind: string) => actions.some(a => a.kind === kind && a.status === "done" && a.completion_evidence.trim());
  if (rank >= 1 && [c.owner, c.problem, c.expected, c.affected].some(v => !v.trim())) issues.push("Complete the owner, problem, expected condition and affected scope.");
  if (rank >= 2 && (!c.containment.trim() || !done("containment"))) issues.push("Record containment and complete a containment action with evidence.");
  if (rank >= 3 && (!c.root_cause.trim() || !c.cause_evidence.trim())) issues.push("Record the root cause and supporting evidence.");
  if (rank >= 4 && !done("corrective")) issues.push("Complete a corrective action with evidence.");
  if (rank >= 5 && (!c.prevention.trim() || !c.verification_plan.trim() || !done("preventive"))) issues.push("Record prevention, complete a preventive action and define the effectiveness check.");
  if (target === "closed") {
    if (!c.verification_result.trim() || !c.verified_on || c.verified_on > today || c.verified_on < c.reported_on) issues.push("Record effectiveness results and a verification date between the reported date and today.");
    if (actions.some(a => a.status !== "done")) issues.push("Complete all remaining actions before closure.");
  }
  return issues;
}
