// 에이전트 상태 수신·조회(#764) — Claude Code 등 CLI 훅이 이벤트를 POST하면 저장 + SSE 푸시,
// 레포탭/호버 카드가 GET(폴백)·SSE(실시간)로 읽는다. 저장·푸시 로직은 @/lib/agentStatus 싱글턴.
import { upsert, query, emit, remove, normPath, prune, type AgentState } from "@/lib/agentStatus";
import { emitEdit } from "@/lib/mcpActivity";

export const runtime = "nodejs";

// 코드 편집·실행 툴만 학습 신호로(#857). Read/Grep/Glob 등 탐색은 노이즈라 제외(그래프 툴이 커버).
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Update", "Bash"]);

// Claude 훅 이벤트 → 상태. 모르는 이벤트(SubagentStop 등)는 null(상태 변경 안 함).
function deriveState(event: string): AgentState | null {
  switch (event) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse": return "working";
    case "Notification": return "waiting"; // 입력/권한 대기
    case "Stop": return "done";
    default: return null;
  }
}

// tool_input을 짧은 한 줄로 — Bash=command, Edit/Write/Read=file_path 등.
function shortToolInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input.slice(0, 120);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const cand = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description;
    if (typeof cand === "string") return cand.slice(0, 120);
    try { return JSON.stringify(o).slice(0, 120); } catch { return undefined; }
  }
  return String(input).slice(0, 120);
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? normPath(body.cwd) : "";
  // 세션 제거(#765) — 버퍼 드라이버가 에이전트 종료(셸 복귀) 감지 시. cwd+sessionId 엔트리 삭제 후 푸시.
  if (body.clear === true) {
    if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
    const removed = remove(cwd, typeof body.sessionId === "string" ? body.sessionId : "");
    if (removed) emit(cwd);
    return Response.json({ ok: true, cleared: removed });
  }
  const event = typeof body.event === "string" ? body.event : "";
  // 소스 2가지: 훅(event→deriveState) 또는 버퍼 스크레이핑(explicit state, #765). 하나는 있어야 함.
  const VALID: AgentState[] = ["working", "waiting", "blocked", "done"];
  const explicit = typeof body.state === "string" && (VALID as string[]).includes(body.state) ? (body.state as AgentState) : null;
  if (!cwd || (!event && !explicit)) return Response.json({ error: "cwd and (event or state) required" }, { status: 400 });
  const now = Date.now();
  const state = explicit ?? deriveState(event);
  if (state === null) { prune(now); return Response.json({ ok: true, ignored: event }); }
  upsert({
    cwd,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : "",
    agent: typeof body.agent === "string" && body.agent ? body.agent : "claude",
    state,
    tool: typeof body.tool === "string" ? body.tool : undefined,
    toolInput: shortToolInput(body.toolInput),
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 200) : undefined,
  }, now);
  prune(now);
  emit(cwd); // SSE 구독자에게 즉시 푸시(폴링 대기 없이)
  // 편집 활동을 학습 스트림으로도(#857) — 코드 편집·실행 툴일 때만. emit 실패가 응답 막지 않게.
  try {
    const tool = typeof body.tool === "string" ? body.tool : "";
    const target = shortToolInput(body.toolInput);
    if (state === "working" && tool && target && EDIT_TOOLS.has(tool)) emitEdit(cwd, tool, target, false, now);
  } catch { /* 무시 */ }
  return Response.json({ ok: true });
}

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  return Response.json({ ok: true, statuses: query(root, Date.now()) });
}
