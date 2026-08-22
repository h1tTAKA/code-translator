// statusCheckRollup 정규화(#814) — CheckRun/StatusContext 혼재를 {name,state,url}로 통일.
// 서브3(브랜치 CI)·서브5(PR) 공용. state: success|failure|pending|neutral.
export type CheckState = "success" | "failure" | "pending" | "neutral";
export interface Check { name: string; state: CheckState; url?: string }
export interface CheckSummary { pass: number; fail: number; pending: number; total: number }

function oneState(c: GhCheckRaw): CheckState {
  // StatusContext: state(SUCCESS|PENDING|FAILURE|ERROR|EXPECTED)
  if (c.state) {
    const s = c.state.toUpperCase();
    if (s === "SUCCESS") return "success";
    if (s === "FAILURE" || s === "ERROR") return "failure";
    if (s === "PENDING" || s === "EXPECTED") return "pending";
    return "neutral";
  }
  // CheckRun: status(QUEUED|IN_PROGRESS|COMPLETED) + conclusion(SUCCESS|FAILURE|...)
  if ((c.status || "").toUpperCase() !== "COMPLETED") return "pending";
  const con = (c.conclusion || "").toUpperCase();
  if (con === "SUCCESS") return "success";
  if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(con)) return "failure";
  return "neutral"; // SKIPPED, NEUTRAL 등
}

export function normalizeChecks(rollup: GhCheckRaw[] | undefined): Check[] {
  return (rollup || []).map((c) => ({ name: c.name || c.context || "check", state: oneState(c), url: c.detailsUrl || c.targetUrl }));
}

export function summarize(checks: Check[]): CheckSummary {
  const s: CheckSummary = { pass: 0, fail: 0, pending: 0, total: checks.length };
  for (const c of checks) {
    if (c.state === "success") s.pass++;
    else if (c.state === "failure") s.fail++;
    else if (c.state === "pending") s.pending++;
  }
  return s;
}
