"use client";

import { IconSitemap, IconX } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

// 기능별 아키텍처 플로우 패널(#743) — Manyfast 유저플로우식. 커밋1: 골격(자리표시). 렌더는 커밋3.
export default function RepoFlowPane({ feature, onClose }: { feature?: string | null; onClose?: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconSitemap size={14} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{feature || t("flow.title")}</span>
        {onClose && (
          <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")}
            className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconX size={14} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
        {t("flow.pickFeature")}
      </div>
    </div>
  );
}
