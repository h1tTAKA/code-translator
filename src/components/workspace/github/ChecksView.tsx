"use client";
// CI 체크 뷰(#814, 서브3 재사용) — statusCheckRollup 정규화 결과를 통과/실패/진행 아이콘 목록으로.
// compact=true면 요약 배지만(PR 목록 행용), false면 전체 목록(PR 상세·브랜치 CI).
import { useState } from "react";
import { IconCircleCheck, IconCircleX, IconLoader2, IconCircle, IconExternalLink, IconChevronRight } from "@tabler/icons-react";
import { normalizeChecks, summarize, type CheckState } from "@/components/workspace/github/checks";
import { relTime } from "@/lib/relTime";

function StateIcon({ state, size = 13 }: { state: CheckState; size?: number }) {
  if (state === "success") return <IconCircleCheck size={size} stroke={2} className="text-emerald-500" aria-hidden />;
  if (state === "failure") return <IconCircleX size={size} stroke={2} className="text-rose-500" aria-hidden />;
  if (state === "pending") return <IconLoader2 size={size} className="animate-spin text-amber-500" aria-hidden />;
  return <IconCircle size={size} stroke={2} className="text-zinc-400" aria-hidden />;
}

export function ChecksSummary({ rollup }: { rollup: GhCheckRaw[] | undefined }) {
  const s = summarize(normalizeChecks(rollup));
  if (!s.total) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px]">
      {s.fail > 0 ? <StateIcon state="failure" size={11} /> : s.pending > 0 ? <StateIcon state="pending" size={11} /> : <StateIcon state="success" size={11} />}
      <span className="text-zinc-400 dark:text-zinc-500">{s.pass}/{s.total}</span>
    </span>
  );
}

export default function ChecksView({ rollup }: { rollup: GhCheckRaw[] | undefined }) {
  const checks = normalizeChecks(rollup);
  const [open, setOpen] = useState<number | null>(null);
  if (!checks.length) return null;
  return (
    <ul className="flex flex-col">
      {checks.map((c, i) => {
        const expanded = open === i;
        const hasDetail = !!(c.workflow || c.startedAt || c.description);
        return (
          <li key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/40">
            <div className="flex items-center gap-1.5 py-1 text-[11px]">
              <button type="button" onClick={() => setOpen(expanded ? null : i)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded}>
                {hasDetail && <IconChevronRight size={11} stroke={2.5} className={`shrink-0 text-zinc-400 transition ${expanded ? "rotate-90" : ""}`} aria-hidden />}
                <StateIcon state={c.state} />
                <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{c.name}</span>
              </button>
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" aria-label="details"><IconExternalLink size={12} stroke={2} aria-hidden /></a>}
            </div>
            {expanded && hasDetail && (
              <div className="mb-1 ml-5 flex flex-col gap-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                {c.workflow && <span>{c.workflow}</span>}
                {c.startedAt && <span>{relTime(c.startedAt)}{c.completedAt ? ` → ${relTime(c.completedAt)}` : ""}</span>}
                {c.description && <span className="break-words">{c.description}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
