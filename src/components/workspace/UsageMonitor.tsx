"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconGauge, IconRefresh, IconSparkles, IconTerminal2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import type { ProviderUsage, ProviderUsageResult, UsageWindow } from "@/lib/usage/types";

const STALE_MS = 30_000; // 최근 결과 재사용(호버마다 재호출 방지)

function barColor(pct: number): string {
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

// 사용 한도 윈도우 한 줄 — 라벨 + %·리셋 + 진행 바.
function WinRow({ label, w }: { label: string; w: UsageWindow | null | undefined }) {
  if (!w) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {Math.round(w.usedPercent)}%{w.resetLabel ? <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-500">· {w.resetLabel}</span> : null}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full transition-all ${barColor(w.usedPercent)}`} style={{ width: `${Math.min(100, Math.max(0, w.usedPercent))}%` }} />
      </div>
    </div>
  );
}

// provider 한 블록 — 아이콘+이름 + 윈도우들 또는 상태 메시지.
function ProviderBlock({ u, name, Icon, t }: { u: ProviderUsage; name: string; Icon: typeof IconSparkles; t: (k: string) => string }) {
  const hasWindows = u.status === "ok" && (u.session || u.weekly || u.fableWeekly);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
        <Icon size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
        {name}
      </div>
      {hasWindows ? (
        <div className="flex flex-col gap-2">
          <WinRow label={t("usage.session")} w={u.session} />
          <WinRow label={t("usage.weekly")} w={u.weekly} />
          <WinRow label={t("usage.fable")} w={u.fableWeekly} />
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {u.status === "unavailable" ? t("usage.unavailable") : t("usage.error")}
        </p>
      )}
    </div>
  );
}

// 하단 바 우측 사용량 모니터(#735) — 아이콘 호버 시 Claude·Codex 한도 팝오버. 데스크톱에서만.
export default function UsageMonitor() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ProviderUsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fetchedAt = useRef(0);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(데스크톱 API 판별은 클라에서만)
  useEffect(() => { setReady(true); }, []);

  const api = ready && typeof window !== "undefined" ? window.nunopiDesktop : undefined;

  const load = useCallback(async (force: boolean) => {
    const fn = window.nunopiDesktop?.getProviderUsage;
    if (!fn) return;
    if (!force && data && Date.now() - fetchedAt.current < STALE_MS) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fn();
      setData(r);
      fetchedAt.current = Date.now();
    } catch (e) {
      // IPC 실패(예: 앱 완전 재시작 안 해 핸들러 없음) 등 — "loading"에 갇히지 않게 에러로 노출.
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [data]);

  // 마운트 시 1회 자동 로드 — 호버 전에 미리 채워 팝오버가 바로 뜨게.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 로드(내부 setState는 이펙트 동기 실행 아님)
  useEffect(() => { if (api?.getProviderUsage) void load(false); }, [api, load]);

  if (ready && !api?.getProviderUsage) return null; // 웹 등 미지원(마운트 전엔 렌더해 깜빡임 방지)

  return (
    <div className="relative" onMouseEnter={() => { setOpen(true); void load(false); }} onMouseLeave={() => setOpen(false)}>
      <button type="button" title={t("usage.title")} aria-label={t("usage.title")}
        className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
        <IconGauge size={14} stroke={2} aria-hidden />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1.5 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-[#15161d]">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("usage.title")}</span>
            <button type="button" onClick={() => void load(true)} disabled={loading} title={t("usage.refresh")} aria-label={t("usage.refresh")}
              className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
              <IconRefresh size={13} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
            </button>
          </div>
          {data ? (
            <div className="flex flex-col gap-3.5">
              <ProviderBlock u={data.claude} name="Claude" Icon={IconSparkles} t={t} />
              <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
              <ProviderBlock u={data.codex} name="Codex" Icon={IconTerminal2} t={t} />
            </div>
          ) : err ? (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("usage.error")}</p>
              <p className="break-words text-[10px] text-zinc-400 dark:text-zinc-600">{err}</p>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("usage.loading")}</p>
          )}
        </div>
      )}
    </div>
  );
}
