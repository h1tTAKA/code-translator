// MCP 툴콜 활동 버스(#855) — 에이전트가 부른 코드그래프 툴을 앱으로 push(실시간 학습 브릿지).
// agentStatus.ts 패턴 미러: globalThis 싱글턴(dev 라우트 리로드 생존) + emit/subscribe fan-out + 최근 링버퍼.
export type ConceptKind = "symbol" | "file" | "query" | "repo";
export interface ActivityEvent {
  root: string;
  tool: string;      // katchup_find_code 등
  kind: ConceptKind;
  target: string;    // 심볼명/파일/쿼리 — 에이전트가 관심 둔 개념
  isError: boolean;
  ts: number;
}

const RING_MAX = 200; // 최근 이벤트 상한(메모리 누수 방지)
const g = globalThis as unknown as { __nunopiMcpActivity?: ActivityEvent[]; __nunopiMcpActListeners?: Set<(e: ActivityEvent) => void> };
const ring: ActivityEvent[] = g.__nunopiMcpActivity ?? (g.__nunopiMcpActivity = []);
const listeners: Set<(e: ActivityEvent) => void> = g.__nunopiMcpActListeners ?? (g.__nunopiMcpActListeners = new Set());

const normPath = (p: string) => p.replace(/\/+$/, "");

// 툴+인자 → 관심 개념. check_freshness 등 개념 아닌 툴/빈 인자는 null(스킵).
export function extractConcept(tool: string, args: Record<string, unknown>): { kind: ConceptKind; target: string } | null {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  switch (tool) {
    case "katchup_find_code":
    case "katchup_find_all": { const t = s(args.name); return t ? { kind: "symbol", target: t } : null; }
    case "katchup_trace_calls": { const t = s(args.symbol); return t ? { kind: "symbol", target: t } : null; }
    case "katchup_file_api": { const t = s(args.file); return t ? { kind: "file", target: t } : null; }
    case "katchup_search": { const t = s(args.query); return t ? { kind: "query", target: t } : null; }
    case "katchup_repo_map": return { kind: "repo", target: "레포 구조" };
    default: return null; // check_freshness 등
  }
}

// 툴콜 방출(라우트 seam이 호출). 개념 추출 실패면 무시.
export function emitToolCall(root: string, tool: string, args: Record<string, unknown>, isError: boolean, now: number): void {
  const c = extractConcept(tool, args);
  if (!c) return;
  const ev: ActivityEvent = { root: normPath(root), tool, kind: c.kind, target: c.target, isError, ts: now };
  ring.push(ev);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); // ponytail: 200번째마다 O(n) splice, 처리량 커지면 Ring 클래스로
  for (const fn of listeners) { try { fn(ev); } catch { /* 개별 리스너 실패 무시 */ } }
}

// SSE 구독(해제 함수 반환).
export function subscribe(fn: (e: ActivityEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// 최근 이벤트(초기 표시용) — root 필터.
export function recent(root: string, limit = 50): ActivityEvent[] {
  const r = normPath(root);
  return ring.filter((e) => e.root === r).slice(-limit).map((e) => ({ ...e })); // 방어 복사(호출부 변이로 링 오염 방지)
}
