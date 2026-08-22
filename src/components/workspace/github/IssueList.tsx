"use client";
// GitHub 패널 이슈 목록(#813) — gh issue list(브릿지 #810) → 필터(open/closed/all) + 행 목록.
// 행 클릭 시 onOpen(number)로 상세(IssueDetail)로. reloadKey 변하면 재조회(패널 새로고침 연동).
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Filter = "open" | "closed" | "all";
type Load = { loading: boolean; rows?: GhIssue[]; error?: string };

function StateDot({ state }: { state: string }) {
  const open = state.toUpperCase() === "OPEN";
  return <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${open ? "bg-emerald-500" : "bg-purple-500"}`} aria-hidden />;
}

export default function IssueList({ root, reloadKey, onOpen }: { root: string; reloadKey: number; onOpen: (n: number) => void }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const [load, setLoad] = useState<Load>({ loading: true });
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const gh = window.nunopiDesktop?.github;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(root/filter/reload 변경마다 재조회)
    if (!gh?.issueList) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    setLoad({ loading: true });
    (async () => {
      const r = await gh.issueList(root, filter);
      if (!mountedRef.current) return;
      if (r.ok) setLoad({ loading: false, rows: r.data });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, filter, reloadKey, t]);

  const FILTERS: Filter[] = ["open", "closed", "all"];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 필터 탭 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${filter === f ? "bg-mustard-500/15 text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
            {t(f === "open" ? "github.filterOpen" : f === "closed" ? "github.filterClosed" : "github.filterAll")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {load.loading ? (
          <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : load.error ? (
          <div className="flex items-start gap-2 p-4 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error}</span></div>
        ) : !load.rows?.length ? (
          <p className="p-4 text-[12px] text-zinc-400 dark:text-zinc-500">{t("github.empty")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {load.rows.map((it) => (
              <li key={it.number}>
                <button type="button" onClick={() => onOpen(it.number)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <StateDot state={it.state} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{it.number}</span>
                      <span className="min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{it.title}</span>
                    </span>
                    {it.labels.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {it.labels.map((l) => (
                          <span key={l.name} className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] text-zinc-500 dark:text-zinc-400" style={{ backgroundColor: `#${l.color}22` }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `#${l.color}` }} aria-hidden />{l.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
