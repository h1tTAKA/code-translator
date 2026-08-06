"use client";
// 워크스페이스 터미널 멀티탭(#678) — 탭 바 + 활성 터미널. pty는 메인서 id별로 생존(#647 A안).
// 활성 탭만 렌더(전환 시 remount → scrollback 재생). 탭 목록은 레포별 localStorage 영속.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconTerminal2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Terminal from "@/components/workspace/Terminal";

interface Tab { id: string; title: string }
const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);

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
  const seq = useRef(initial.tabs.length); // "터미널 N" 번호(단조 증가)

  // 폴더(cwd) 바뀌면 그 레포 탭셋 재로드(첫 마운트는 lazy init).
  useEffect(() => {
    if (curStore.current === store) return;
    curStore.current = store;
    const d = loadTabs(store, t("workspace.terminalTab", { n: 1 }));
    setTabs(d.tabs); setActiveId(d.activeId); seq.current = d.tabs.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store 변경만
  }, [store]);

  // 탭 목록 영속.
  useEffect(() => {
    try { localStorage.setItem(store, JSON.stringify({ tabs, activeId })); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터 변경 시 저장(store는 클로저 현재값)
  }, [tabs, activeId]);

  function addTab() {
    seq.current += 1;
    const tab = { id: genId(), title: t("workspace.terminalTab", { n: seq.current }) };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }
  function closeTab(id: string) {
    try { window.nunopiDesktop?.terminal?.kill({ id }); } catch { /* ignore */ } // pty 정리(좀비 방지)
    setTabs((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (!next.length) { const nid = genId(); return [{ id: nid, title: t("workspace.terminalTab", { n: 1 }) }]; } // 최소 1개
      return next;
    });
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const rest = tabs.filter((x) => x.id !== id);
      return rest.length ? rest[rest.length - 1].id : cur; // 활성 닫으면 마지막으로
    });
  }

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 터미널 탭 바 */}
      <div className="nunopi-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50/60 px-1.5 py-1 dark:border-zinc-800 dark:bg-zinc-900/40">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveId(tab.id)}
              className={`group inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition ${on ? "bg-white font-semibold text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-white/70 dark:text-zinc-500 dark:hover:bg-zinc-800"}`}>
              <IconTerminal2 size={11} stroke={2} className="shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{tab.title}</span>
              {tabs.length > 1 && (
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-0.5 shrink-0 rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-600" aria-label={t("workspace.terminalClose")}>
                  <IconX size={9} stroke={2.5} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
        <button type="button" onClick={addTab} title={t("workspace.terminalNew")}
          className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-white hover:text-[#3B34E2] dark:hover:bg-zinc-700 dark:hover:text-[#8b86f5]">
          <IconPlus size={12} stroke={2.5} aria-hidden />
        </button>
      </div>
      {/* 활성 터미널(id로 remount → 그 pty 재생) */}
      <div className="min-h-0 flex-1">
        {active && <Terminal key={active.id} id={active.id} cwd={cwd} />}
      </div>
    </div>
  );
}
