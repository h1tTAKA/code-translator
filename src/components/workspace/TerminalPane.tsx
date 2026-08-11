"use client";
// 워크스페이스 터미널 멀티탭(#678) — 탭 바 + 활성 터미널. pty는 메인서 id별로 생존(#647 A안).
// 활성 탭만 렌더(전환 시 remount → scrollback 재생). 탭 목록은 레포별 localStorage 영속.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconTerminal2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Terminal from "@/components/workspace/Terminal";

interface Tab { id: string; title: string }
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 터미널 탭 바 — 에디터 탭 느낌(활성 상단 강조선·구분선·닫기). pr-6 외곽: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[#15161d]">
      <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <div key={tab.id}
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}
              onClick={() => setActiveId(tab.id)}>
              {on && <span className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundImage: "linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)" }} aria-hidden />}
              <IconTerminal2 size={13} stroke={2} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#8b86f5]" : "text-zinc-400"}`} aria-hidden />
              <span className="whitespace-nowrap">{tab.title}</span>
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
          className="flex shrink-0 items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-[#3B34E2] dark:hover:bg-zinc-800 dark:hover:text-[#8b86f5]">
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
