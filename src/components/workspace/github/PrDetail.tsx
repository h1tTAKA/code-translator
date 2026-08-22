"use client";
// GitHub 패널 PR 상세(#814) — gh pr view → 제목·상태·머지상태·담당자 + 체크(ChecksView)·본문·코멘트.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Markdown from "@/components/learning/Markdown";
import { relTime } from "@/lib/relTime";
import ChecksView from "@/components/workspace/github/ChecksView";

type Load = { loading: boolean; data?: GhPrDetail; error?: string };

function stateLabel(d: GhPrDetail, t: (k: string) => string): { text: string; cls: string } {
  const st = d.state.toUpperCase();
  if (d.isDraft && st === "OPEN") return { text: t("github.draft"), cls: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400" };
  if (st === "MERGED") return { text: t("github.merged"), cls: "bg-purple-500/15 text-purple-500 dark:text-purple-400" };
  if (st === "CLOSED") return { text: d.state, cls: "bg-rose-500/15 text-rose-500 dark:text-rose-400" };
  return { text: d.state, cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

export default function PrDetail({ root, number, onBack }: { root: string; number: number; onBack: () => void }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ loading: true });
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const gh = window.nunopiDesktop?.github;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(number 변경마다 재조회)
    if (!gh?.prView) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    setLoad({ loading: true });
    (async () => {
      const r = await gh.prView(root, number);
      if (!mountedRef.current || myId !== reqIdRef.current) return;
      if (r.ok) setLoad({ loading: false, data: r.data });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, number, t]);

  const d = load.data;
  const sl = d ? stateLabel(d, t) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconArrowLeft size={13} stroke={2} aria-hidden /> {t("github.back")}
        </button>
        <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{number}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {load.loading ? (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : load.error || !d || !sl ? (
          <div className="flex items-start gap-2 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error || t("github.error")}</span></div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{d.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${sl.cls}`}>{sl.text}</span>
                <span>{d.author?.login}</span>
                {d.createdAt && <span>· {relTime(d.createdAt)}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-zinc-400 dark:text-zinc-500">{t("github.assignees")}:</span>
                {d.assignees?.length
                  ? d.assignees.map((a) => <span key={a.login} className="rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{a.login}</span>)
                  : <span className="text-zinc-400 dark:text-zinc-500">{t("github.noAssignee")}</span>}
              </div>
            </div>
            {/* CI 체크(#814, 서브3 재사용) */}
            {d.statusCheckRollup?.length > 0 && (
              <div className="rounded-md border border-zinc-100 p-2 dark:border-zinc-800/60">
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.checks")}</p>
                <ChecksView root={root} rollup={d.statusCheckRollup} />
              </div>
            )}
            {d.body?.trim() ? <Markdown className="text-[12px]">{d.body}</Markdown> : <p className="text-[12px] italic text-zinc-400 dark:text-zinc-500">—</p>}
            {d.comments?.length > 0 && (
              <div className="mt-1 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.comments")} · {d.comments.length}</p>
                {d.comments.map((c, i) => (
                  <div key={i} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/40">
                    <p className="mb-1 text-[10px] text-zinc-400 dark:text-zinc-500">{c.author?.login}</p>
                    <Markdown className="text-[12px]">{c.body}</Markdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
