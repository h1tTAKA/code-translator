"use client";
// 워크스페이스 터미널 멀티탭(#678) — 탭 바 + 활성 터미널. pty는 메인서 id별로 생존(#647 A안).
// 활성 탭만 렌더(전환 시 remount → scrollback 재생). 탭 목록은 레포별 localStorage 영속.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconTerminal2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Terminal from "@/components/workspace/Terminal";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";

interface Tab { id: string; title: string; customTitle?: string } // customTitle=유저 더블클릭 리네임(#861, 최우선)
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

  // 리네임 시작/커밋(#861) — 빈 값이면 customTitle 해제(자동 제목 복귀).
  const startRename = (tab: Tab, shown: string) => { setEditingId(tab.id); setDraft(tab.customTitle ?? shown); };
  const commitRename = () => {
    const id = editingId; if (!id) return;
    const v = draft.trim();
    setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, customTitle: v || undefined } : x)));
    setEditingId(null);
  };

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];
  // 활성 터미널 탭이 오버플로로 스크롤 밖이면 안 보임(#801) — 활성 탭에 콜백 ref로 스크롤 인투 뷰.
  // (터미널 자동 펴기는 N/A: 접히면 pane·+버튼이 dock에서 제거돼 외부 "열기" 트리거가 없고, 재표시는 헤더 토글=이미 펴짐.)
  const scrollTabIntoView = useCallback((el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, []);

  // 탭별 실행 중 에이전트(#803) — main이 버퍼 파싱으로 판정한 agent id(node 래퍼 CLI도 잡음). 탭 이름·아이콘용.
  // pty는 push 이벤트가 없어(에이전트 실행/종료=프로세스 교체) 2s 폴링. list()는 전 세션 반환 → tab.id로 조회.
  const [agentById, setAgentById] = useState<Record<string, AgentId>>({});
  const [taskById, setTaskById] = useState<Record<string, string>>({}); // OSC 대화 제목(#861) — 탭 제목 소스
  const [editingId, setEditingId] = useState<string | null>(null);       // 리네임 편집 중 탭
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const api = window.nunopiDesktop?.terminal;
    if (!api?.list) return;
    let alive = true;
    const tick = async () => {
      try {
        const ls = await api.list();
        // s.agent는 string|null(.cjs 경계라 타입 강제 불가) — AGENT_META 키로 검증한 값만 수용(미지 문자열→라벨/로고 조회 크래시 방지).
        if (alive) {
          setAgentById(Object.fromEntries(ls.filter((s) => s.agent && s.agent in AGENT_META).map((s) => [s.id, s.agent as AgentId])));
          setTaskById(Object.fromEntries(ls.filter((s) => s.task && s.task.trim()).map((s) => [s.id, s.task!.trim()])));
        }
      } catch { /* ignore */ }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 터미널 탭 바 — 에디터 탭 느낌(활성 상단 강조선·구분선·닫기). pr-6 외곽: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[#15161d]">
      <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          // 실행 중 에이전트면 그 라벨·로고, 아니면(셸/유휴) 기존 "터미널 N"·터미널 아이콘. title은 안 바꿔 종료 시 자동 원복(#803).
          const agent = agentById[tab.id] ?? null;
          // 제목 우선순위(#861, orca式): 유저 리네임 > OSC 대화 제목(≈첫 질문) > 에이전트 라벨 > 기본(터미널 N).
          const label = tab.customTitle?.trim() || taskById[tab.id] || (agent ? AGENT_META[agent].label : tab.title);
          const editing = editingId === tab.id;
          return (
            <div key={tab.id} ref={on ? scrollTabIntoView : undefined}
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}
              onClick={() => setActiveId(tab.id)}
              onDoubleClick={() => startRename(tab, label)}
              title={editing ? undefined : label}>
              {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
              {agent
                ? <span className="shrink-0"><AgentLogo agent={agent} size={13} /></span>
                : <IconTerminal2 size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />}
              {editing
                ? <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setEditingId(null); }}
                    onBlur={commitRename}
                    className="w-28 rounded border border-mustard-500/50 bg-white px-1 py-0 text-[12px] text-zinc-800 outline-none dark:bg-zinc-900 dark:text-zinc-100" />
                : <span className="max-w-[160px] truncate whitespace-nowrap">{label}</span>}
              {tabs.length > 1 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("workspace.terminalClose")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={addTab} title={t("workspace.terminalNew")} aria-label={t("workspace.terminalNew")}
          className="flex shrink-0 items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
          <IconPlus size={15} stroke={2.5} aria-hidden />
        </button>
      </div>
      </div>
      {/* 활성 터미널(id로 remount → 그 pty 재생) */}
      <div className="min-h-0 flex-1">
        {active && <Terminal key={active.id} id={active.id} cwd={cwd} />}
      </div>
    </div>
  );
}
