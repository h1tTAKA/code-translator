"use client";

import { useEffect, useState } from "react";
import { IconFiles, IconGitBranch, IconArrowUp, IconArrowDown, IconPencil, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { AgentLogo, identifyAgent, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";

// 레포 탭 호버 카드(#764) — 그 레포에서 도는 에이전트(터미널 foreground 프로세스) + git 워크트리를 실시간으로.
// UsageMonitor(#752) 팝오버 패턴: 탭 rect 기준 fixed 위치(부모가 계산해 left/top 주입). 아래로 뜬다.
// 골격(휴리스틱): 에이전트 = 프로세스명 식별 + running. 상세 상태(working/waiting)는 후속 커밋에서 훅으로.

interface Worktree { path: string; branch: string | null; head: string; detached: boolean; bare: boolean; locked: boolean; dirty: number; ahead: number; behind: number; }
interface AgentRow { id: string; agent: AgentId; }

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");

export default function RepoTabHoverCard({ path, left, top, onMouseEnter, onMouseLeave }: {
  path: string;
  left: number;
  top: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useT();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [idleTerms, setIdleTerms] = useState(0);
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null); // null=로딩

  // 터미널 세션 → 이 레포(cwd) 필터 → 에이전트/유휴 분류. 열린 동안 폴링(프로세스명 변화 push 없음).
  useEffect(() => {
    const d = typeof window !== "undefined" ? window.nunopiDesktop : undefined;
    if (!d?.terminal?.list) return;
    let alive = true;
    const inRepo = (cwd: string) => { const a = norm(cwd), b = norm(path); return a === b || a.startsWith(b + "/"); };
    const load = async () => {
      try {
        const sessions = await d.terminal.list();
        if (!alive) return;
        const ag: AgentRow[] = [];
        let idle = 0;
        for (const s of sessions) {
          if (!inRepo(s.cwd)) continue;
          const a = identifyAgent(s.process);
          if (a) ag.push({ id: s.id, agent: a }); else idle++; // 에이전트 아니면(셸·기타) 유휴로 셈
        }
        setAgents(ag);
        setIdleTerms(idle);
      } catch { /* ignore */ }
    };
    void load();
    const iv = setInterval(load, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, [path]);

  // 워크트리 — 열 때 + 레포 파일 변경(#739) 시 재조회.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/repo/git-worktree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        if (alive) setWorktrees(r.ok && d.ok ? (d.worktrees ?? []) : []);
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
        <IconFiles size={13} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="truncate">{basename(path)}</span>
      </div>

      {/* 에이전트 */}
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("workspace.agents")}</div>
      {agents.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{idleTerms > 0 ? t("workspace.termsIdle", { n: idleTerms }) : t("workspace.noAgents")}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[12px] text-zinc-700 dark:text-zinc-200">
              <AgentLogo agent={a.agent} size={14} />
              <span className="min-w-0 flex-1 truncate">{AGENT_META[a.agent].label}</span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{t("workspace.agentRunning")}</span>
            </div>
          ))}
          {idleTerms > 0 && <div className="text-[10px] text-zinc-400 dark:text-zinc-500">{t("workspace.termsIdle", { n: idleTerms })}</div>}
        </div>
      )}

      {/* 워크트리 */}
      <div className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("workspace.worktrees")}</div>
      {worktrees === null ? (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : worktrees.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.noWorktrees")}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {worktrees.map((w) => (
            <div key={w.path} className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
              <IconGitBranch size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={w.path}>{w.detached ? `${w.head} (detached)` : (w.branch ?? basename(w.path))}</span>
              {w.ahead > 0 && <span className="flex shrink-0 items-center text-emerald-500"><IconArrowUp size={11} stroke={2.5} aria-hidden />{w.ahead}</span>}
              {w.behind > 0 && <span className="flex shrink-0 items-center text-amber-500"><IconArrowDown size={11} stroke={2.5} aria-hidden />{w.behind}</span>}
              {w.dirty > 0 && <span className="flex shrink-0 items-center gap-0.5 text-zinc-400" title={t("workspace.dirtyFiles", { n: w.dirty })}><IconPencil size={10} stroke={2} aria-hidden />{w.dirty}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
