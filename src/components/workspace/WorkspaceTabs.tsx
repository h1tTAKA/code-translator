"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconFiles, IconFolderOpen, IconPlus, IconX, IconCircleCheck, IconLoader2, IconQuestionMark, IconAlertTriangle, IconMessages, IconFileCode, IconFileText } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import WorkspaceView from "@/components/workspace/WorkspaceView";
import WorkspaceModePane from "@/components/workspace/WorkspaceModePane";
import RepoAvatar from "@/components/workspace/RepoAvatar";
import WorkspaceAddMenu, { type AddKind } from "@/components/workspace/WorkspaceAddMenu";
import RepoTabHoverCard from "@/components/workspace/RepoTabHoverCard";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

const TABS_KEY = "nunopi:ws-tabs";       // 열린 탭 배열(#731, #769에서 태그드 유니온으로 확장)
const ACTIVE_KEY = "nunopi:ws-active";   // 활성 탭 키(tabKey)
const OLD_PATH_KEY = "nunopi:workspace-path"; // 구 단일 워크스페이스 경로 — 최초 1회 마이그레이션

// 탭 모델(#769) — 레포 탭은 폴더 경로가 정체성, 모드 탭(질문/코드/글)은 폴더 없이 유니크 id가 정체성.
type ModeKind = "ask" | "code" | "text";
export type Tab =
  | { type: "repo"; path: string }
  | { type: ModeKind; id: string };
// keep-alive·활성 판별 공통 키 — 레포=경로, 모드=id. localStorage active 키로도 씀.
const tabKey = (t: Tab): string => (t.type === "repo" ? `repo:${t.path}` : `${t.type}:${t.id}`);
const isMode = (k: unknown): k is ModeKind => k === "ask" || k === "code" || k === "text";
// 저장된 원소 하나를 Tab으로 — 구 문자열(순수 경로)이면 레포 탭으로 이관, 신규 객체는 검증 후 통과, 그 외 버림.
function migrateTab(x: unknown): Tab | null {
  if (typeof x === "string") return { type: "repo", path: x };
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.type === "repo" && typeof o.path === "string") return { type: "repo", path: o.path };
    if (isMode(o.type) && typeof o.id === "string") return { type: o.type, id: o.id };
  }
  return null;
}

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");

// 모드 탭 표시(#771) — 레포 탭(IconFiles·인디고)과 구분되게 모드별 아이콘·색·이름.
const MODE_TAB: Record<ModeKind, { Icon: typeof IconFiles; labelKey: string; color: string }> = {
  // 색은 누노피 그라데이션의 파란 톤으로 통일 — 레포 아이콘(인디고)·상태 도트(emerald/amber/rose)와 구분.
  ask: { Icon: IconMessages, labelKey: "mode.ask", color: "text-sky-500 dark:text-sky-400" },
  code: { Icon: IconFileCode, labelKey: "mode.code", color: "text-sky-500 dark:text-sky-400" },
  text: { Icon: IconFileText, labelKey: "mode.text", color: "text-sky-500 dark:text-sky-400" },
};

// 탭 상태 도트(#764/#765) — 그 레포 에이전트의 종합 상태(버퍼 스크레이핑). 우선순위: 막힘>대기>작업중>완료.
type TabState = "working" | "waiting" | "blocked" | "done";
function aggregate(states: string[]): TabState | null {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("working")) return "working";
  if (states.includes("done")) return "done";
  return null;
}
// 탭 상태 아이콘 — 호버 카드와 통일. 작업중=앰버 스피너, 대기(yes/no)=앰버 물음표, 막힘=빨간 경고, 완료=초록 체크.
function tabDot(st: TabState | null) {
  if (!st) return null;
  if (st === "done") return <IconCircleCheck size={13} stroke={2} className="shrink-0 text-emerald-500" aria-hidden />;
  if (st === "working") return <IconLoader2 size={13} stroke={2.5} className="shrink-0 animate-spin text-amber-500" aria-hidden />;
  if (st === "waiting") return <IconQuestionMark size={13} stroke={2.5} className="shrink-0 text-amber-500" aria-hidden />;
  if (st === "blocked") return <IconAlertTriangle size={13} stroke={2.5} className="shrink-0 text-rose-500" aria-hidden />;
  return null; // 예상 밖 값 → 아무것도(빨간 삼각형 오탐 방지)
}

// 멀티 워크스페이스 탭(#731) — 여러 레포를 탭으로 열고 전환. 각 탭 = WorkspaceView 인스턴스(key=tabKey).
// 방문한 탭은 숨긴 채 계속 마운트(lazy keep-alive) — 전환해도 도킹/에디터/터미널 상태 보존.
export default function WorkspaceTabs({ active = true, providerId, providerSettings, onExitWorkspace, onOpenMemorize, onOpenSettings }: { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; onExitWorkspace?: () => void; onOpenMemorize?: () => void; onOpenSettings?: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 한 번이라도 활성화된 탭 키 — 이 집합만 실제 마운트(keep-alive). 안 연 탭은 마운트 안 함.
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const modeSeq = useRef(0); // 모드 탭 id 세션 카운터(같은 ms 충돌 방지, #769)
  const [addMenu, setAddMenu] = useState<{ left: number; top: number } | null>(null); // "+" 드롭다운 픽커(#769)
  const closeAddMenu = useCallback(() => setAddMenu(null), []); // 안정 참조 — 메뉴 effect 재부착 최소화
  // "+" 버튼 아래로 드롭다운 앵커링. 화면 오른쪽 넘침 방지.
  const openAddMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 256, M = 8; // 메뉴 폭(w-64=256px) · 화면 여백
    setAddMenu({ left: Math.max(M, Math.min(r.left, window.innerWidth - W - M)), top: r.bottom + 6 });
  };
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
  // 탭별 종합 상태(#764) — 호버 없이도 돌아가는중/완료/대기를 도트로. 레포 탭만 대상. 워크스페이스 활성 동안 폴링.
  const [repoStatus, setRepoStatus] = useState<Record<string, TabState | null>>({});
  useEffect(() => {
    if (!mounted || !active) return;
    const repoPaths = tabs.filter((x): x is { type: "repo"; path: string } => x.type === "repo").map((x) => x.path);
    if (repoPaths.length === 0) return;
    let alive = true;
    // 각 레포의 에이전트 상태(버퍼 스크레이핑, /api/agent/status)로 종합 도트. 프로세스명 휴리스틱은 제거(#765).
    const poll = () => {
      Promise.all(repoPaths.map(async (p) => {
        try { const r = await fetch(`/api/agent/status?root=${encodeURIComponent(p)}`); const j = await r.json(); return [p, aggregate(j?.ok ? (j.statuses ?? []).map((s: { state: string }) => s.state) : [])] as const; }
        catch { return [p, null] as const; }
      })).then((entries) => { if (alive) setRepoStatus(Object.fromEntries(entries)); });
    };
    void poll();
    // SSE 푸시(#764) — 훅이 열린 레포 중 하나의 cwd 상태를 바꾸면 즉시 재조회. 폴링은 폴백 하트비트.
    const within = (cwd: string) => { const a = norm(cwd); return repoPaths.some((p) => { const b = norm(p); return a === b || a.startsWith(b + "/"); }); };
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agent/status/stream");
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (typeof d?.cwd === "string" && within(d.cwd)) void poll(); } catch { /* ignore */ } };
    } catch { /* EventSource 미지원 → 폴링만 */ }
    const iv = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(iv); es?.close(); };
  }, [mounted, active, tabs]);

  useEffect(() => {
    let ts: Tab[] = [];
    let a: string | null = null;
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) ts = arr.map(migrateTab).filter((x): x is Tab => x !== null); }
      else { const old = localStorage.getItem(OLD_PATH_KEY); if (old) ts = [{ type: "repo", path: old }]; } // 구 단일 → 탭 1개로 이관
      const keys = ts.map(tabKey);
      const act = localStorage.getItem(ACTIVE_KEY);
      // 구 active(순수 경로)면 repo: 접두 붙여 매칭 시도. 못 맞추면 첫 탭.
      const want = act && keys.includes(act) ? act : act && keys.includes(`repo:${act}`) ? `repo:${act}` : null;
      a = want ?? keys[0] ?? null;
    } catch { /* ignore */ }
    /* eslint-disable react-hooks/set-state-in-effect -- 마운트 1회 복원 */
    setMounted(true);
    setTabs(ts);
    setActiveKey(a);
    if (a) setVisited(new Set([a]));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 영속.
  useEffect(() => { if (!mounted) return; try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch { /* ignore */ } }, [tabs, mounted]);
  useEffect(() => { if (!mounted) return; try { if (activeKey) localStorage.setItem(ACTIVE_KEY, activeKey); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }, [activeKey, mounted]);

  function activate(key: string) {
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key))); // keep-alive 대상 등록
    setActiveKey(key);
  }

  // 탭 드래그 재정렬(#775) — pointer 기반(HTML5 DnD 아님). native 드래그는 브라우저가 "복사" 커서
  // 배지를 강제로 띄워 못 없애므로, pointerdown/move/up으로 직접 구현해 커서를 완전 제어한다.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overAfter, setOverAfter] = useState(false); // 드롭 위치가 over 탭의 뒤(오른쪽)인가 — 맨 뒤 이동 표시용
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 }); // 떠다니는 고스트 위치(마우스 추적)
  const dragState = useRef<{ key: string; startX: number; moved: boolean } | null>(null);
  // 배열 순서 = 화면 순서. from을 to(앞/뒤) 위치로 splice → setTabs → 기존 effect가 localStorage 영속.
  function reorder(fromKey: string, toKey: string, after: boolean) {
    if (fromKey === toKey) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => tabKey(x) === fromKey);
      const to = prev.findIndex((x) => tabKey(x) === toKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      let insertAt = after ? to + 1 : to;
      if (from < insertAt) insertAt--; // from 제거로 뒤쪽 인덱스가 하나 당겨짐
      next.splice(insertAt, 0, moved);
      return next;
    });
  }
  function tabPointerDown(e: React.PointerEvent<HTMLDivElement>, key: string) {
    if ((e.target as HTMLElement).closest("button")) return; // 닫기 버튼은 자체 클릭 — 드래그 시작 안 함.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { key, startX: e.clientX, moved: false };
  }
  function tabPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragState.current;
    if (!st) return;
    if (!st.moved) {
      if (Math.abs(e.clientX - st.startX) < 5) return; // 임계 미만 = 클릭(드래그 시작 안 함)
      st.moved = true;
      setDraggingKey(st.key);
      setHover(null);
      cancelClose();
    }
    setDragPos({ x: e.clientX, y: e.clientY }); // 고스트가 마우스 따라오게
    // 마우스 아래의 탭 키(pointerCapture라 좌표로 직접 탐색). 탭 중앙 오른쪽이면 "뒤에 삽입".
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-tab-key]") as HTMLElement | null;
    const overK = el?.getAttribute("data-tab-key") ?? null;
    if (overK && overK !== st.key && el) {
      const r = el.getBoundingClientRect();
      setOverKey(overK);
      setOverAfter(e.clientX > r.left + r.width / 2);
    } else {
      setOverKey(null);
    }
  }
  function tabPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragState.current;
    dragState.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (st?.moved) {
      if (overKey && overKey !== st.key) reorder(st.key, overKey, overAfter);
    } else if (st) {
      activate(st.key); // 안 움직였으면 클릭 = 탭 활성화.
    }
    setDraggingKey(null);
    setOverKey(null);
  }

  async function addRepoTab() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) {
        const path = r.path;
        const key = `repo:${path}`;
        if (tabs.some((x) => tabKey(x) === key)) { // 이미 열린 레포면 새 탭 없이 기존 탭 활성 + 안내(#787)
          toast(t("workspace.repoAlreadyOpen"), "error");
          activate(key);
          return;
        }
        setTabs((prev) => [...prev, { type: "repo", path }]);
        activate(key);
      }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  // 모드 탭(질문/코드/글) 추가(#769) — 폴더 없이 유니크 id로 새 빈 탭. id는 생성 후 불변(keep-alive·영속 키).
  // Date.now(세션 간 구분) + 세션 카운터(같은 ms 연속 생성 시 충돌 방지).
  function addModeTab(kind: ModeKind) {
    const existing = tabs.find((x) => x.type === kind); // kind당 1개(#787) — 이미 있으면 그 탭 활성 + 안내
    if (existing) {
      toast(t("workspace.modeAlreadyOpen"), "error");
      activate(tabKey(existing));
      return;
    }
    const id = `${Date.now().toString(36)}-${modeSeq.current++}`;
    const key = `${kind}:${id}`;
    setTabs((prev) => [...prev, { type: kind, id }]);
    activate(key);
  }

  // 메뉴 선택 → 레포는 폴더 다이얼로그, 모드는 즉시 빈 탭.
  const onPick = (kind: AddKind) => {
    if (kind === "repo") void addRepoTab();
    else addModeTab(kind);
  };

  function closeTab(key: string) {
    const idx = tabs.findIndex((x) => tabKey(x) === key);
    if (idx < 0) return;
    const next = tabs.filter((x) => tabKey(x) !== key);
    if (activeKey === key) {
      // 활성 탭을 닫으면 이웃으로 활성 이동.
      const neighbor = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      const nk = neighbor ? tabKey(neighbor) : null;
      setActiveKey(nk);
      if (nk) setVisited((prev) => (prev.has(nk) ? prev : new Set(prev).add(nk)));
    }
    setTabs(next);
    // 닫힌 탭은 keep-alive에서 제거(언마운트). localStorage per-path는 남아 재오픈 시 복원.
    setVisited((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
  }

  if (mounted && !desktop) {
    return <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>;
  }

  // 탭 스트립 — WorkspaceView 헤더 한 줄의 좌측에 pill 형태로(#731). 헤더가 border-b 제공, 자체 bar 없음.
  const tabStrip = (
    <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5">
      {tabs.map((tab) => {
        const key = tabKey(tab);
        const on = key === activeKey;
        const p = tab.type === "repo" ? tab.path : null;
        const mode = tab.type === "repo" ? null : MODE_TAB[tab.type];
        const Icon = mode ? mode.Icon : IconFiles;
        // 아이콘 색 — 활성 레포=인디고, 활성 모드=모드색(레포와 구분), 비활성=회색.
        const iconColor = !on ? "text-zinc-400" : mode ? mode.color : "text-[#3B34E2] dark:text-[#8b86f5]";
        const label = p ? basename(p) : t(mode!.labelKey);
        const showDrop = overKey === key && draggingKey !== null && draggingKey !== key;
        const isDragging = draggingKey === key;
        // 드롭 바 — 앞(왼쪽)/뒤(오른쪽). 뒤=맨 끝 이동을 명확히 보여준다.
        const dropBar = !showDrop ? "" : overAfter
          ? "after:absolute after:-right-0.5 after:top-1/2 after:h-4/5 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-[#3B34E2] dark:after:bg-[#8b86f5]"
          : "before:absolute before:-left-0.5 before:top-1/2 before:h-4/5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-[#3B34E2] dark:before:bg-[#8b86f5]";
        return (
          <div key={key} data-tab-key={key} title={p ?? label}
            onPointerDown={(e) => tabPointerDown(e, key)}
            onPointerMove={tabPointerMove}
            onPointerUp={tabPointerUp}
            onMouseEnter={p ? (e) => openHover(p, e.currentTarget) : undefined} onMouseLeave={p ? scheduleClose : undefined}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition ${draggingKey ? "cursor-grabbing" : "cursor-grab"} ${isDragging ? "opacity-50" : ""} ${on ? "bg-white text-zinc-800 shadow-sm ring-1 ring-inset ring-[#3B34E2]/55 dark:bg-[#0b0c12] dark:text-zinc-100 dark:ring-[#8b86f5]/45" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"} ${dropBar}`}>
            {p ? tabDot(repoStatus[p] ?? null) : null}
            {p ? <RepoAvatar path={p} size={13} iconClassName={`shrink-0 ${iconColor}`} /> : <Icon size={13} stroke={2} className={`shrink-0 ${iconColor}`} aria-hidden />}
            <span className="max-w-[12rem] truncate whitespace-nowrap font-medium">{label}</span>
            <button type="button" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: label, message: t("workspace.closeTabConfirm"), detail: t("workspace.closeTabConfirmDetail"), confirmText: t("workspace.closeTab"), tone: "warn" })) closeTab(key); }} title={t("workspace.closeTab")} aria-label={t("workspace.closeTab")}
              className={`ml-0.5 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <IconX size={12} stroke={2.5} aria-hidden />
            </button>
          </div>
        );
      })}
      {/* 새 탭 추가 — 마지막 탭 바로 옆(#731). "+" 항상 드롭다운 먼저(#769). */}
      <button type="button" onClick={(e) => openAddMenu(e.currentTarget)} disabled={picking || !mounted} title={t("workspace.newTab")} aria-label={t("workspace.newTab")}
        className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200">
        <IconPlus size={16} stroke={2} aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 본문 — 방문한 탭들 keep-alive(활성만 보임). 탭 스트립은 각 WorkspaceView 헤더 아래에. 탭 없으면 빈 상태. */}
      <div className="relative flex min-h-0 flex-1">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-1 items-center justify-center p-8">
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:text-[#8b86f5]">
                <IconFiles size={26} stroke={1.75} aria-hidden />
              </div>
              <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("workspace.intro")}</p>
              <button type="button" onClick={(e) => openAddMenu(e.currentTarget)} disabled={picking || !mounted}
                className="inline-flex items-center gap-2 rounded-xl bg-[#3B34E2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
                <IconFolderOpen size={16} stroke={2} aria-hidden /> {t("workspace.pickFolder")}
              </button>
            </div>
          </div>
        ) : (
          tabs.filter((tab) => visited.has(tabKey(tab))).map((tab) => {
            const key = tabKey(tab);
            const on = key === activeKey;
            return (
              <div key={key} className={on ? "flex min-h-0 w-full flex-1" : "hidden"}>
                {tab.type === "repo" ? (
                  <WorkspaceView
                    path={tab.path}
                    active={active && on}
                    providerId={providerId}
                    providerSettings={providerSettings}
                    onExitWorkspace={onExitWorkspace}
                    onOpenMemorize={onOpenMemorize}
                    onOpenSettings={onOpenSettings}
                    tabStrip={on ? tabStrip : undefined}
                  />
                ) : (
                  <WorkspaceModePane
                    kind={tab.type}
                    active={active && on}
                    providerId={providerId}
                    providerSettings={providerSettings}
                    tabStrip={on ? tabStrip : undefined}
                    onExitWorkspace={onExitWorkspace}
                    onOpenMemorize={onOpenMemorize}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
      {hover && (
        <RepoTabHoverCard key={hover.path} path={hover.path} left={hover.left} top={hover.top}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />
      )}
      {/* 드래그 고스트(#775) — 마우스 따라오는 탭 미리보기. pointer 방식이라 native 잔영이 없어 직접 그린다. */}
      {draggingKey && (() => {
        const gt = tabs.find((x) => tabKey(x) === draggingKey);
        if (!gt) return null;
        const gp = gt.type === "repo" ? gt.path : null;
        const gm = gt.type === "repo" ? null : MODE_TAB[gt.type];
        const GIcon = gm ? gm.Icon : IconFiles;
        const glabel = gp ? basename(gp) : t(gm!.labelKey);
        return (
          <div className="pointer-events-none fixed z-[60] flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-zinc-800 opacity-90 shadow-lg ring-1 ring-black/10 dark:bg-[#0b0c12] dark:text-zinc-100 dark:ring-white/10"
            style={{ left: dragPos.x + 10, top: dragPos.y + 10 }}>
            <GIcon size={13} stroke={2} className={`shrink-0 ${gm ? gm.color : "text-[#3B34E2] dark:text-[#8b86f5]"}`} aria-hidden />
            <span className="max-w-[12rem] truncate">{glabel}</span>
          </div>
        );
      })()}
      <WorkspaceAddMenu anchor={addMenu} onClose={closeAddMenu} onPick={onPick} />
    </div>
  );
}
