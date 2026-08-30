"use client";
// 워크스페이스 터미널 멀티탭(#678) — 탭 바 + 활성 터미널. pty는 메인서 id별로 생존(#647 A안).
// 활성 탭만 렌더(전환 시 remount → scrollback 재생). 탭 목록은 레포별 localStorage 영속.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconTerminal2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Terminal from "@/components/workspace/Terminal";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";

interface Tab { id: string; title: string; customTitle?: string } // customTitle=유저 더블클릭 리네임(최우선, 영속)
const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
// 새 탭 번호 = 현재 안 쓰는 가장 낮은 양수(#756). 닫은 자리를 다시 채워 "터미널 4처럼 계속 증가" 방지.
// 제목 끝 숫자로 판별(모든 로케일 포맷이 "… {n}"이라 안전).
function nextNum(tabs: Tab[]): number {
  const used = new Set<number>();
  for (const tb of tabs) { const m = tb.title.match(/(\d+)\s*$/); if (m) used.add(parseInt(m[1], 10)); }
  let n = 1; while (used.has(n)) n += 1;
  return n;
}

function loadTabs(store: string, firstTitle: string): { tabs: Tab[]; activeId: string } {
  const fresh = () => { const id = genId(); return { tabs: [{ id, title: firstTitle }], activeId: id }; };
  if (typeof localStorage === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(store);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as { tabs?: Tab[]; activeId?: string };
    if (!Array.isArray(p.tabs) || !p.tabs.length) return fresh();
    const tabs = p.tabs.filter((t) => t && typeof t.id === "string");
    if (!tabs.length) return fresh();
    const activeId = p.activeId && tabs.some((t) => t.id === p.activeId) ? p.activeId : tabs[0].id;
    return { tabs, activeId };
  } catch { return fresh(); }
}

export default function TerminalPane({ cwd }: { cwd: string }) {
  const t = useT();
  const store = `nunopi:ws-terms:${cwd}`;
  const initial = useMemo(() => loadTabs(store, t("workspace.terminalTab", { n: 1 })), []); // eslint-disable-line react-hooks/exhaustive-deps -- 마운트 1회 복원(cwd 변경은 아래 이펙트)
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const curStore = useRef(store);

  // 폴더(cwd) 바뀌면 그 레포 탭셋 재로드(첫 마운트는 lazy init).
  useEffect(() => {
    if (curStore.current === store) return;
    curStore.current = store;
    const d = loadTabs(store, t("workspace.terminalTab", { n: 1 }));
    setTabs(d.tabs); setActiveId(d.activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store 변경만
  }, [store]);

  // 탭 목록 영속.
  useEffect(() => {
    try { localStorage.setItem(store, JSON.stringify({ tabs, activeId })); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터 변경 시 저장(store는 클로저 현재값)
  }, [tabs, activeId]);

  function addTab() {
    const id = genId();
    // 번호는 functional update 안에서 최신 prev로 계산 — 연타 시 중복 번호 방지.
    setTabs((prev) => [...prev, { id, title: t("workspace.terminalTab", { n: nextNum(prev) }) }]);
    setActiveId(id);
  }
  function closeTab(id: string) {
    try { window.nunopiDesktop?.terminal?.kill({ id }); } catch { /* ignore */ } // pty 정리(좀비 방지)
    const next = tabs.filter((x) => x.id !== id);
    if (!next.length) { // 마지막 탭 → 새 빈 탭으로 대체 + 그 탭 활성(번호 1로 리셋)
      const nt = { id: genId(), title: t("workspace.terminalTab", { n: 1 }) };
      setTabs([nt]); setActiveId(nt.id);
      return;
    }
    setTabs(next);
    if (activeId === id) setActiveId(next[next.length - 1].id); // 활성 닫으면 마지막으로
  }

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];
  // 활성 터미널 탭이 오버플로로 스크롤 밖이면 안 보임(#801) — 활성 탭에 콜백 ref로 스크롤 인투 뷰.
  // (터미널 자동 펴기는 N/A: 접히면 pane·+버튼이 dock에서 제거돼 외부 "열기" 트리거가 없고, 재표시는 헤더 토글=이미 펴짐.)
  const scrollTabIntoView = useCallback((el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, []);

  // 탭별 실행 중 에이전트(#803) — main이 버퍼 파싱으로 판정한 agent id(node 래퍼 CLI도 잡음). 탭 이름·아이콘용.
  // pty는 push 이벤트가 없어(에이전트 실행/종료=프로세스 교체) 2s 폴링. list()는 전 세션 반환 → tab.id로 조회.
  const [agentById, setAgentById] = useState<Record<string, AgentId>>({});
  useEffect(() => {
    const api = window.nunopiDesktop?.terminal;
    if (!api?.list) return;
    let alive = true;
    const tick = async () => {
      try {
        const ls = await api.list();
        // s.agent는 string|null(.cjs 경계라 타입 강제 불가) — AGENT_META 키로 검증한 값만 수용(미지 문자열→라벨/로고 조회 크래시 방지).
        if (alive) setAgentById(Object.fromEntries(ls.filter((s) => s.agent && s.agent in AGENT_META).map((s) => [s.id, s.agent as AgentId])));
      } catch { /* ignore */ }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 탭 드래그 재정렬(#864) — 레포 탭처럼 순서 변경. 배열 순서=화면 순서, setTabs가 localStorage 영속.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const reorderTabs = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const insertAt = next.findIndex((x) => x.id === toId); // 제거 후 재계산
      next.splice(insertAt < 0 ? next.length : insertAt, 0, moved); // 대상 앞에 삽입
      return next;
    });
  };

  // 더블클릭 리네임(#864) — 편집 중 탭 id + 입력값. 빈 값 확정 시 customTitle 해제(자동 이름 복귀).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const commitRename = (id: string) => {
    const v = editValue.trim();
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, customTitle: v || undefined } : tb)));
    setEditingId(null);
  };

  // ＋ 메뉴(#864) — orca식. 새 터미널 또는 에이전트 선택. 에이전트는 새 탭 생성 후 그 탭에 직접 실행(신원 확정).
  const [menuOpen, setMenuOpen] = useState(false);
  const LAUNCHABLE: AgentId[] = ["claude", "codex", "grok", "opencode", "omp", "antigravity", "cursor", "hermes"]; // gemini 제외(구글=antigravity)
  const newTerminal = () => { setMenuOpen(false); addTab(); };
  const launchInNewTab = (agent: AgentId) => {
    setMenuOpen(false);
    const id = genId();
    setTabs((prev) => [...prev, { id, title: t("workspace.terminalTab", { n: nextNum(prev) }) }]);
    setActiveId(id);
    void window.nunopiDesktop?.terminal?.launchAgent?.({ id, agent }); // main이 pty ensure 대기 후 커맨드 주입
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 터미널 탭 바 — 에디터 탭 느낌(활성 상단 강조선·구분선·닫기). pr-6 외곽: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[#15161d]">
      <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          // 아이콘=에이전트 로고(실행 중)/터미널. 제목 우선순위(#864): 유저 리네임 > 에이전트 라벨 > "터미널 N".
          const agent = agentById[tab.id] ?? null;
          const label = tab.customTitle || (agent ? AGENT_META[agent].label : tab.title);
          const editing = editingId === tab.id;
          return (
            <div key={tab.id} ref={on ? scrollTabIntoView : undefined}
              draggable={!editing}
              onDragStart={(e) => { setDragId(tab.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragId && dragId !== tab.id) { e.preventDefault(); setOverId(tab.id); } }}
              onDragLeave={() => setOverId((o) => (o === tab.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragId) reorderTabs(dragId, tab.id); setDragId(null); setOverId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"} ${dragId === tab.id ? "opacity-40" : ""}`}
              onClick={() => setActiveId(tab.id)}>
              {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
              {overId === tab.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-mustard-500" aria-hidden />}
              {agent
                ? <span className="shrink-0"><AgentLogo agent={agent} size={13} /></span>
                : <IconTerminal2 size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />}
              {editing ? (
                <input autoFocus value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(tab.id); else if (e.key === "Escape") setEditingId(null); }}
                  onBlur={() => commitRename(tab.id)}
                  className="w-[130px] rounded border border-mustard-400 bg-white px-1 py-0 text-[12px] text-zinc-800 outline-none dark:bg-zinc-900 dark:text-zinc-100" />
              ) : (
                <span className="max-w-[200px] truncate whitespace-nowrap" title={label}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditValue(tab.customTitle || (agent ? AGENT_META[agent].label : "")); setEditingId(tab.id); }}>{label}</span>
              )}
              {tabs.length > 1 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("workspace.terminalClose")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        {/* ＋ 메뉴(#864) — 새 터미널 또는 에이전트 선택(orca식). */}
        <div className="relative flex shrink-0 items-center">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} title={t("workspace.terminalNew")} aria-label={t("workspace.terminalNew")}
            className="flex items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
            <IconPlus size={15} stroke={2.5} aria-hidden />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-[#0b0c12]">
                <button type="button" onClick={newTerminal}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  <IconTerminal2 size={14} stroke={2} aria-hidden /><span className="whitespace-nowrap">{t("workspace.terminalNew")}</span>
                </button>
                <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                {LAUNCHABLE.map((a) => (
                  <button key={a} type="button" onClick={() => launchInNewTab(a)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    <AgentLogo agent={a} size={14} />
                    <span className="whitespace-nowrap">{AGENT_META[a].label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      </div>
      {/* 활성 터미널(id로 remount → 그 pty 재생) */}
      <div className="min-h-0 flex-1">
        {active && <Terminal key={active.id} id={active.id} cwd={cwd} />}
      </div>
    </div>
  );
}
