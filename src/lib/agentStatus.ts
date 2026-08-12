// 에이전트 상태 저장 + 변경 푸시(#764) — POST(훅 수신)·GET(조회)·SSE 스트림 라우트가 공유하는 서버 싱글턴.
// 훅이 상태를 POST하면 즉시 SSE 리스너로 fan-out → 화면은 폴링 없이 그 순간 갱신(Orca식 푸시).
// globalThis 캐시로 dev 라우트 리로드에도 store/listeners 생존.

export type AgentState = "working" | "waiting" | "blocked" | "done";

export interface Entry {
  cwd: string;
  sessionId: string;
  agent: string;
  state: AgentState;
  tool?: string;
  toolInput?: string;
  prompt?: string;
  updatedAt: number;
  stateStartedAt: number;
}

const TTL_MS = 10 * 60 * 1000;      // 갱신 없으면 폐기(유령 방지)
const DONE_TTL_MS = 3 * 60 * 1000;  // done(유휴)은 몇 분 유지 — 살아있는데 순삭 방지

const g = globalThis as unknown as { __nunopiStatusStore?: Map<string, Entry>; __nunopiStatusListeners?: Set<(cwd: string) => void> };
const store: Map<string, Entry> = g.__nunopiStatusStore ?? (g.__nunopiStatusStore = new Map());
const listeners: Set<(cwd: string) => void> = g.__nunopiStatusListeners ?? (g.__nunopiStatusListeners = new Set());

export const normPath = (p: string) => p.replace(/\/+$/, "");
const keyOf = (cwd: string, sessionId: string) => `${cwd} ${sessionId}`;

export function prune(now: number): void {
  for (const [k, e] of store) {
    const ttl = e.state === "done" ? DONE_TTL_MS : TTL_MS;
    if (now - e.updatedAt > ttl) store.delete(k);
  }
}

// 상태 upsert — state 바뀔 때만 stateStartedAt 리셋. 저장 후 cwd 반환(호출부가 emit).
export function upsert(fields: { cwd: string; sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string }, now: number): void {
  const key = keyOf(fields.cwd, fields.sessionId);
  const prev = store.get(key);
  store.set(key, {
    cwd: fields.cwd,
    sessionId: fields.sessionId,
    agent: fields.agent,
    state: fields.state,
    tool: fields.state === "working" ? fields.tool : undefined,
    toolInput: fields.state === "working" ? fields.toolInput : undefined,
    prompt: fields.prompt ?? prev?.prompt,
    updatedAt: now,
    stateStartedAt: prev && prev.state === fields.state ? prev.stateStartedAt : now,
  });
}

// 레포 root의 상태 — 에이전트 타입별 최신 1개(sessionId 회전으로 중복 뜨는 것 방지).
export function query(root: string, now: number): Array<{ sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string; since: number; updatedAt: number }> {
  prune(now);
  const r = normPath(root);
  if (!r) return [];
  const inRepo = (cwd: string) => cwd === r || cwd.startsWith(r + "/");
  const latest = new Map<string, Entry>();
  for (const e of store.values()) {
    if (!inRepo(e.cwd)) continue;
    const cur = latest.get(e.agent);
    if (!cur || e.updatedAt > cur.updatedAt) latest.set(e.agent, e);
  }
  return [...latest.values()].map((e) => ({ sessionId: e.sessionId, agent: e.agent, state: e.state, tool: e.tool, toolInput: e.toolInput, prompt: e.prompt, since: e.stateStartedAt, updatedAt: e.updatedAt }));
}

// SSE — 변경 리스너 등록(해제 함수 반환) / fan-out.
export function subscribe(fn: (cwd: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emit(cwd: string): void {
  for (const fn of listeners) { try { fn(cwd); } catch { /* 개별 리스너 실패 무시 */ } }
}
