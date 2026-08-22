"use client";
// GitHub 패널 CI 탭(#812) — 현재 브랜치 PR의 statusCheckRollup을 ChecksView로. 저빈도 폴링(20s)·새로고침.
// 성공(초록)/실패(빨강)/진행(노랑 스피너)은 ChecksView가 담당(orca 동등).
import { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconGitBranch } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import ChecksView from "@/components/workspace/github/ChecksView";
import { normalizeChecks, summarize } from "@/components/workspace/github/checks";

type Load = { loading: boolean; data?: GhChecks; error?: string };
const POLL_MS = 20000;

export default function ChecksTab({ root, reloadKey }: { root: string; reloadKey: number }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ loading: true });
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0);

  const fetchChecks = useCallback(async (showLoading: boolean) => {
    const gh = window.nunopiDesktop?.github;
    if (!gh?.checks) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    if (showLoading) setLoad((p) => ({ loading: true, data: p.data }));
    const r = await gh.checks(root);
    if (!mountedRef.current || myId !== reqIdRef.current) return;
    if (r.ok) setLoad({ loading: false, data: r.data });
    else setLoad({ loading: false, error: r.detail || t("github.error") });
  }, [root, t]);

  // 마운트/root/reload 시 조회 + 20s 폴링(진행 중 CI 갱신). 폴링은 조용히(스피너 X).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 최초 로딩 표시
    void fetchChecks(true);
    const iv = setInterval(() => void fetchChecks(false), POLL_MS);
    return () => clearInterval(iv);
  }, [fetchChecks, reloadKey]);

  const d = load.data;
  const checks = normalizeChecks(d?.statusCheckRollup);
  const s = summarize(checks);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {load.loading && !d ? (
        <div className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
      ) : load.error ? (
        <div className="flex items-start gap-2 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error}</span></div>
      ) : !d || d.noPr ? (
        <p className="text-[12px] text-zinc-400 dark:text-zinc-500">{t("github.noPr")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 브랜치·PR 헤더 */}
          <div className="flex items-center gap-1.5 text-[12px]">
            <IconGitBranch size={13} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
            <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{d.headRefName}</span>
            {d.number != null && <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{d.number}</span>}
          </div>
          {/* 요약(로케일 무관 — 색·숫자로) */}
          {s.total > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {s.fail === 0 && s.pending === 0 && <span className="text-emerald-600 dark:text-emerald-400">{t("github.allPassed")}</span>}
              {s.pending > 0 && <span className="text-amber-500">● {s.pending}</span>}
              {s.fail > 0 && <span className="text-rose-500">● {s.fail}</span>}
              <span>{s.pass}/{s.total}</span>
            </div>
          )}
          {checks.length ? <ChecksView rollup={d.statusCheckRollup} /> : <p className="text-[12px] text-zinc-400 dark:text-zinc-500">{t("github.noChecks")}</p>}
        </div>
      )}
    </div>
  );
}
