"use client";

import { IconSitemap, IconSparkles } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

// 좌측 "레포 분석하기" 섹션(#743) — [분석하기] → 카테고리(기능) 목록 → 기능 클릭 → 플로우 패널.
// 커밋1: 골격(스텁). [분석하기]가 임시로 플로우 패널을 연다(dock 삽입 검증). 카테고리 목록은 커밋2.
export default function RepoAnalyzeSection({ onOpenFlow }: { onOpenFlow?: (feature: string) => void }) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <IconSitemap size={11} stroke={2} className="shrink-0" aria-hidden />
        <span className="truncate">{t("repo.analyzeSection")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button type="button" onClick={() => onOpenFlow?.("")}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#3B34E2] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#322bc9]">
          <IconSparkles size={13} stroke={2} aria-hidden /> {t("repo.analyzeRun")}
        </button>
        <p className="mt-2 px-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("repo.analyzeSoon")}</p>
      </div>
    </div>
  );
}
