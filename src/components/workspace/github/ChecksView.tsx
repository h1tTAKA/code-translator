"use client";
// CI 체크 뷰(#814, 서브3 재사용) — statusCheckRollup 정규화 결과를 통과/실패/진행 아이콘 목록으로.
// compact=true면 요약 배지만(PR 목록 행용), false면 전체 목록(PR 상세·브랜치 CI).
import { IconCircleCheck, IconCircleX, IconLoader2, IconCircle, IconExternalLink } from "@tabler/icons-react";
import { normalizeChecks, summarize, type CheckState } from "@/components/workspace/github/checks";

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
  if (!checks.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {checks.map((c, i) => (
        <li key={i} className="flex items-center gap-1.5 text-[11px]">
          <StateIcon state={c.state} />
          <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{c.name}</span>
          {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" aria-label="details"><IconExternalLink size={12} stroke={2} aria-hidden /></a>}
        </li>
      ))}
    </ul>
  );
}
