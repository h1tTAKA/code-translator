"use client";

import { useEffect, useState } from "react";
import { IconGitBranch, IconArrowUp, IconArrowDown, IconPencil, IconLoader2, IconCircleCheck, IconQuestionMark, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import RepoAvatar from "@/components/workspace/RepoAvatar";

// 레포 탭 호버 카드(#764/#765) — 그 레포에서 도는 에이전트 상태 + git 워크트리를 실시간으로.
// 에이전트 상태는 pty 버퍼 스크레이핑(#765)으로 판정된 것을 /api/agent/status(스토어)에서 읽는다(SSE 푸시 + 폴백 폴링).
// (프로세스명 휴리스틱은 유휴/작업 구분을 못 해 유휴에도 스피너를 띄우던 문제로 제거 — 버퍼 스크레이핑이 정확한 소스.)

interface Worktree { path: string; branch: string | null; head: string; detached: boolean; bare: boolean; locked: boolean; dirty: number; ahead: number; behind: number; subject: string; committedAt: string; }
type AgentState = "working" | "waiting" | "blocked" | "done";
interface AgentStatus { sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string; since?: number; }

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");
// 상대시각(간결) — "3s"/"5m"/"2h"/"4d". committedAt ISO 기준.
function rel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const asAgentId = (s: string): AgentId => (Object.prototype.hasOwnProperty.call(AGENT_META, s) ? (s as AgentId) : "other");

const STATE_KEY: Record<AgentState, string> = { working: "workspace.agentWorking", waiting: "workspace.agentWaiting", blocked: "workspace.agentBlocked", done: "workspace.agentDone" };
const STATE_TEXT: Record<AgentState, string> = { working: "text-amber-500", waiting: "text-amber-500", blocked: "text-rose-500", done: "text-emerald-500" };
// 상태 아이콘 — 작업중=앰버 스피너, 대기(yes/no)=물음표, 막힘=경고, 완료=초록 체크. 색은 부모 텍스트색 상속.
function stateIcon(st: AgentState) {
  const p = { size: 12, stroke: 2.5, "aria-hidden": true } as const;
  if (st === "working") return <IconLoader2 {...p} className="animate-spin" />;
  if (st === "waiting") return <IconQuestionMark {...p} />;
  if (st === "blocked") return <IconAlertTriangle {...p} />;
  return <IconCircleCheck {...p} />;
}

// path별 마지막 스냅샷 캐시 — 재호버 시 즉시 표시(빈 상태 깜빡임·지연 방지, #764).
interface Snap { statuses: AgentStatus[]; worktrees: Worktree[] | null; }
const snapCache = new Map<string, Snap>();

export default function RepoTabHoverCard({ path, left, top, onMouseEnter, onMouseLeave }: {
  path: string;
  left: number;
  top: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useT();
  const seed = snapCache.get(path);
  const [statuses, setStatuses] = useState<AgentStatus[]>(seed?.statuses ?? []); // 버퍼 스크레이핑 상태
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(seed?.worktrees ?? null); // null=로딩

  // 에이전트 상태 — /api/agent/status. SSE 푸시(즉시) + 폴백 폴링(1.5s).
  useEffect(() => {
    let alive = true;
    const inRepo = (cwd: string) => { const a = norm(cwd), b = norm(path); return a === b || a.startsWith(b + "/"); };
    const cacheMerge = (patch: Partial<Snap>) => {
      const prev = snapCache.get(path) ?? { statuses: [], worktrees: null };
      if (!snapCache.has(path) && snapCache.size >= 100) { const oldest = snapCache.keys().next().value; if (oldest !== undefined) snapCache.delete(oldest); } // LRU 상한
      snapCache.set(path, { ...prev, ...patch });
    };
    const load = () => {
      fetch(`/api/agent/status?root=${encodeURIComponent(path)}`).then((r) => r.json()).then((j) => {
        if (!alive) return; const ss: AgentStatus[] = j?.ok ? (j.statuses ?? []) : []; setStatuses(ss); cacheMerge({ statuses: ss });
      }).catch(() => { /* ignore */ });
    };
    void load();
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agent/status/stream");
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (typeof d?.cwd === "string" && inRepo(d.cwd)) void load(); } catch { /* ignore */ } };
    } catch { /* EventSource 미지원 → 폴링만 */ }
    const iv = setInterval(load, 1500);
    return () => { alive = false; clearInterval(iv); es?.close(); };
  }, [path]);

  // 워크트리 — 열 때 + 레포 파일 변경(#739) 시 재조회.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/repo/git-worktree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        const list: Worktree[] = r.ok && d.ok ? (d.worktrees ?? []) : [];
        if (!alive) return;
        setWorktrees(list);
        const prev = snapCache.get(path) ?? { statuses: [], worktrees: null };
        snapCache.set(path, { ...prev, worktrees: list });
      } catch { if (alive) setWorktrees([]); }
    };
    void load();
    const off = (typeof window !== "undefined" ? window.nunopiDesktop : undefined)?.repo?.onChanged?.((p) => { if (p.id === path) void load(); });
    return () => { alive = false; off?.(); };
  }, [path]);

  return (
    <div style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      className="fixed z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-[#0e0f16]">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
        <RepoAvatar path={path} size={14} iconClassName="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" />
        <span className="truncate">{basename(path)}</span>
      </div>

      {/* 에이전트 */}
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("workspace.agents")}</div>
      {statuses.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.noAgents")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {statuses.map((h, i) => {
            const id = asAgentId(h.agent);
            const sub = h.state === "working" && h.tool ? (h.toolInput ? `${h.tool}: ${h.toolInput}` : h.tool) : "";
            return (
              <div key={`s${i}`}>
                <div className="flex items-center gap-2 text-[12px] text-zinc-700 dark:text-zinc-200">
                  <AgentLogo agent={id} size={14} />
                  <span className="min-w-0 flex-1 truncate">{AGENT_META[id].label}</span>
                  <span className={`flex shrink-0 items-center gap-1 text-[10px] ${STATE_TEXT[h.state]}`}>
                    {stateIcon(h.state)}{t(STATE_KEY[h.state])}
                  </span>
                </div>
                {sub && <div className="ml-6 truncate text-[10px] text-zinc-400 dark:text-zinc-500" title={sub}>{sub}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* 워크트리 */}
      <div className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("workspace.worktrees")}</div>
      {worktrees === null ? (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : worktrees.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.noWorktrees")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {worktrees.map((w) => {
            const age = rel(w.committedAt);
            return (
              <div key={w.path}>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <IconGitBranch size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={w.path}>{w.detached ? `${w.head} (detached)` : (w.branch ?? basename(w.path))}</span>
                  {w.ahead > 0 && <span className="flex shrink-0 items-center text-emerald-500"><IconArrowUp size={11} stroke={2.5} aria-hidden />{w.ahead}</span>}
                  {w.behind > 0 && <span className="flex shrink-0 items-center text-amber-500"><IconArrowDown size={11} stroke={2.5} aria-hidden />{w.behind}</span>}
                  {w.dirty > 0 && <span className="flex shrink-0 items-center gap-0.5 text-zinc-400" title={t("workspace.dirtyFiles", { n: w.dirty })}><IconPencil size={10} stroke={2} aria-hidden />{w.dirty}</span>}
                </div>
                {w.subject && (
                  <div className="ml-[18px] flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <span className="min-w-0 truncate" title={w.subject}>{w.subject}</span>
                    {age && <span className="shrink-0 tabular-nums text-zinc-300 dark:text-zinc-600">· {age}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
