"use client";

import { useEffect, useRef, useState } from "react";
import { IconFiles, IconFolderOpen, IconPlus, IconX, IconCircleCheck, IconLoader2, IconQuestionMark, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import WorkspaceView from "@/components/workspace/WorkspaceView";
import RepoTabHoverCard from "@/components/workspace/RepoTabHoverCard";
import { identifyAgent } from "@/components/workspace/AgentLogo";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

const TABS_KEY = "nunopi:ws-tabs";       // 열린 워크스페이스 경로 배열(#731)
const ACTIVE_KEY = "nunopi:ws-active";   // 활성 경로
const OLD_PATH_KEY = "nunopi:workspace-path"; // 구 단일 워크스페이스 경로 — 최초 1회 마이그레이션

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");

// 탭 상태 도트(#764) — 레포에서 도는 에이전트의 종합 상태. 우선순위: 막힘>대기>작업중>완료>실행(휴리스틱).
type TabState = "working" | "waiting" | "blocked" | "done" | "running";
function aggregate(states: string[], heuristicAgent: boolean): TabState | null {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("working")) return "working";
  if (states.includes("done")) return "done";
  return heuristicAgent ? "running" : null;
}
// 탭 상태 아이콘 — 호버 카드와 통일. 작업중·실행중=앰버 스피너, 대기(yes/no)=앰버 물음표, 막힘=빨간 경고, 완료=초록 체크.
function tabDot(st: TabState | null) {
  if (!st) return null;
  if (st === "done") return <IconCircleCheck size={13} stroke={2} className="shrink-0 text-emerald-500" aria-hidden />;
  if (st === "working" || st === "running") return <IconLoader2 size={13} stroke={2.5} className="shrink-0 animate-spin text-amber-500" aria-hidden />;
  if (st === "waiting") return <IconQuestionMark size={13} stroke={2.5} className="shrink-0 text-amber-500" aria-hidden />;
  return <IconAlertTriangle size={13} stroke={2.5} className="shrink-0 text-rose-500" aria-hidden />; // blocked
}

// 멀티 워크스페이스 탭(#731) — 여러 레포를 탭으로 열고 전환. 각 탭 = WorkspaceView 인스턴스(key=path).
// 방문한 탭은 숨긴 채 계속 마운트(lazy keep-alive) — 전환해도 도킹/에디터/터미널 상태 보존.
export default function WorkspaceTabs({ active = true, providerId, providerSettings, onExitWorkspace, onOpenMemorize, onOpenSettings }: { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; onExitWorkspace?: () => void; onOpenMemorize?: () => void; onOpenSettings?: () => void }) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  // 한 번이라도 활성화된 경로 — 이 집합만 실제 마운트(keep-alive). 안 연 탭은 마운트 안 함.
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  // 레포 탭 호버 카드(#764) — 에이전트·워크트리 실시간. 탭↔카드 사이 이동 허용 위해 지연 닫기.
  const [hover, setHover] = useState<{ path: string; left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 150); };
  const openHover = (p: string, el: HTMLElement) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 288, M = 8; // 카드 폭(w-72) · 화면 여백
    const left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
    setHover({ path: p, left, top: r.bottom + 6 }); // 탭 아래로
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  // 탭별 종합 상태(#764) — 호버 없이도 돌아가는중/완료/대기를 도트로. 워크스페이스 활성 동안 폴링.
  const [repoStatus, setRepoStatus] = useState<Record<string, TabState | null>>({});
  useEffect(() => {
    if (!mounted || !active || paths.length === 0) return;
    let alive = true;
    const d = window.nunopiDesktop;
    const poll = async () => {
      let sessions: { cwd: string; process: string }[] = [];
      if (d?.terminal?.list) { try { sessions = await d.terminal.list(); } catch { /* ignore */ } }
      const next: Record<string, TabState | null> = {};
      await Promise.all(paths.map(async (p) => {
        const nb = norm(p);
        const inRepo = (cwd: string) => { const a = norm(cwd); return a === nb || a.startsWith(nb + "/"); };
        let states: string[] = [];
        try { const r = await fetch(`/api/agent/status?root=${encodeURIComponent(p)}`); const j = await r.json(); if (r.ok && j.ok) states = (j.statuses ?? []).map((s: { state: string }) => s.state); } catch { /* ignore */ }
        const heur = sessions.some((s) => inRepo(s.cwd) && identifyAgent(s.process));
        next[p] = aggregate(states, heur);
      }));
      if (alive) setRepoStatus(next);
    };
    void poll();
    // SSE 푸시(#764) — 훅이 열린 레포 중 하나의 cwd 상태를 바꾸면 즉시 재조회. 폴링은 폴백 하트비트(4s).
    const within = (cwd: string) => { const a = norm(cwd); return paths.some((p) => { const b = norm(p); return a === b || a.startsWith(b + "/"); }); };
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agent/status/stream");
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (typeof d?.cwd === "string" && within(d.cwd)) void poll(); } catch { /* ignore */ } };
    } catch { /* EventSource 미지원 → 폴링만 */ }
    const iv = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(iv); es?.close(); };
  }, [mounted, active, paths]);

  useEffect(() => {
    let ps: string[] = [];
    let a: string | null = null;
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) ps = arr.filter((x): x is string => typeof x === "string"); }
      else { const old = localStorage.getItem(OLD_PATH_KEY); if (old) ps = [old]; } // 구 단일 → 탭 1개로 이관
      const act = localStorage.getItem(ACTIVE_KEY);
      a = act && ps.includes(act) ? act : ps[0] ?? null;
    } catch { /* ignore */ }
    /* eslint-disable react-hooks/set-state-in-effect -- 마운트 1회 복원 */
    setMounted(true);
    setPaths(ps);
    setActivePath(a);
    if (a) setVisited(new Set([a]));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 영속.
  useEffect(() => { if (!mounted) return; try { localStorage.setItem(TABS_KEY, JSON.stringify(paths)); } catch { /* ignore */ } }, [paths, mounted]);
  useEffect(() => { if (!mounted) return; try { if (activePath) localStorage.setItem(ACTIVE_KEY, activePath); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }, [activePath, mounted]);

  function activate(p: string) {
    setVisited((prev) => (prev.has(p) ? prev : new Set(prev).add(p))); // keep-alive 대상 등록
    setActivePath(p);
  }

  async function addWorkspace() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) {
        const p = r.path;
        setPaths((prev) => (prev.includes(p) ? prev : [...prev, p])); // 이미 열려 있으면 그 탭 활성만
        activate(p);
      }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  function closeTab(p: string) {
    const next = paths.filter((x) => x !== p);
    if (activePath === p) {
      // 활성 탭을 닫으면 이웃으로 활성 이동.
      const idx = paths.indexOf(p);
      const neighbor = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      setActivePath(neighbor);
      if (neighbor) setVisited((prev) => (prev.has(neighbor) ? prev : new Set(prev).add(neighbor)));
    }
    setPaths(next);
    // 닫힌 탭은 keep-alive에서 제거(언마운트). localStorage per-path는 남아 재오픈 시 복원.
    setVisited((prev) => { if (!prev.has(p)) return prev; const n = new Set(prev); n.delete(p); return n; });
  }

  if (mounted && !desktop) {
    return <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>;
  }

  // 탭 스트립 — WorkspaceView 헤더 한 줄의 좌측에 pill 형태로(#731). 헤더가 border-b 제공, 자체 bar 없음.
  const tabStrip = (
    <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5">
      {paths.map((p) => {
        const on = p === activePath;
        return (
          <div key={p} onClick={() => activate(p)} title={p}
            onMouseEnter={(e) => openHover(p, e.currentTarget)} onMouseLeave={scheduleClose}
            className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition ${on ? "bg-white text-zinc-800 shadow-sm dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"}`}>
            {tabDot(repoStatus[p] ?? null)}
            <IconFiles size={13} stroke={2} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#8b86f5]" : "text-zinc-400"}`} aria-hidden />
            <span className="max-w-[12rem] truncate whitespace-nowrap font-medium">{basename(p)}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); closeTab(p); }} title={t("workspace.closeTab")} aria-label={t("workspace.closeTab")}
              className={`ml-0.5 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <IconX size={12} stroke={2.5} aria-hidden />
            </button>
          </div>
        );
      })}
      {/* 새 워크스페이스 추가 — 마지막 탭 바로 옆(#731). */}
      <button type="button" onClick={addWorkspace} disabled={picking || !mounted} title={t("workspace.newTab")} aria-label={t("workspace.newTab")}
        className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200">
        <IconPlus size={16} stroke={2} aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 본문 — 방문한 탭들 keep-alive(활성만 보임). 탭 스트립은 각 WorkspaceView 헤더 아래에. 탭 없으면 빈 상태. */}
      <div className="relative flex min-h-0 flex-1">
        {paths.length === 0 ? (
          <div className="flex h-full flex-1 items-center justify-center p-8">
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:text-[#8b86f5]">
                <IconFiles size={26} stroke={1.75} aria-hidden />
              </div>
              <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("workspace.intro")}</p>
              <button type="button" onClick={addWorkspace} disabled={picking || !mounted}
                className="inline-flex items-center gap-2 rounded-xl bg-[#3B34E2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
                <IconFolderOpen size={16} stroke={2} aria-hidden /> {t("workspace.pickFolder")}
              </button>
            </div>
          </div>
        ) : (
          paths.filter((p) => visited.has(p)).map((p) => (
            <div key={p} className={p === activePath ? "flex min-h-0 w-full flex-1" : "hidden"}>
              <WorkspaceView
                path={p}
                active={active && p === activePath}
                providerId={providerId}
                providerSettings={providerSettings}
                onExitWorkspace={onExitWorkspace}
                onOpenMemorize={onOpenMemorize}
                onOpenSettings={onOpenSettings}
                tabStrip={p === activePath ? tabStrip : undefined}
              />
            </div>
          ))
        )}
      </div>
      {hover && (
        <RepoTabHoverCard key={hover.path} path={hover.path} left={hover.left} top={hover.top}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />
      )}
    </div>
  );
}
