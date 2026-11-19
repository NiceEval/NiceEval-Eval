import type { QueryDocument } from "../../../../lib/query.ts";

type RunMember = {
  evalId: string;
  verdict: string | null;
  relation: string | null;
  locator: string | null;
};

/** Read both candidate generations' published member shape. */
export function runMembers(doc: QueryDocument | null): RunMember[] {
  if (!Array.isArray(doc?.run?.plannedAttempts)) throw new Error("run.get 缺少 plannedAttempts");
  return doc.run.plannedAttempts.map((member: any) => {
    const verdict = member.verdict ?? member.publication?.verdict ?? null;
    if (typeof member.evalId !== "string" ||
        (verdict !== null && !["passed", "failed", "errored", "skipped"].includes(verdict))) {
      throw new Error("Run 成员的 Eval ID 或终态无效");
    }
    return {
      evalId: member.evalId,
      verdict,
      relation: member.relation ?? null,
      locator: member.publication?.attemptLocator ?? null,
    };
  });
}
