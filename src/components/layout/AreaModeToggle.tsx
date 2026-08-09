"use client";

import { IconCode, IconFileText, IconMessage2, IconHome, IconLayoutColumns, IconMessages } from "@tabler/icons-react";
import type { ViewMode } from "@/lib/viewMode";
import { useT } from "@/lib/i18n/I18nProvider";

interface AreaModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // 1차 "질문·분석" 클릭 — 직전 하위뷰로 복귀(enterQAArea). 워크스페이스에서 돌아올 때와 동일.
  onEnterQA: () => void;
  disabled?: boolean;
}

// 질문·분석 영역의 하위 뷰(2차 세그). memorize는 상시 퀵으로 빠져 여기 없음(#725).
const SUB_OPTIONS: { value: ViewMode; tKey: string; Icon: typeof IconCode }[] = [
  { value: "history", tKey: "mode.history", Icon: IconHome },
  { value: "ask", tKey: "mode.ask", Icon: IconMessage2 },
  { value: "code", tKey: "mode.code", Icon: IconCode },
  { value: "text", tKey: "mode.text", Icon: IconFileText },
];

// 2-tier 영역 토글(#725): 1차 워크스페이스|질문·분석(크게, 텍스트) + 2차 질문·분석 하위(아이콘, 질문·분석일 때만).
export default function AreaModeToggle({ viewMode, onViewModeChange, onEnterQA, disabled = false }: AreaModeToggleProps) {
  const t = useT();
  const inQA = viewMode !== "workspace";

  const primaryBase =
    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
  const on = "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50";
  const off = "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200";

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* 1차 — 큰 두 영역 */}
      <div role="tablist" aria-label={t("nav.area")} className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
        <button
          type="button" role="tab" aria-selected={!inQA} disabled={disabled}
          onClick={() => onViewModeChange("workspace")}
          className={`${primaryBase} ${!inQA ? on : off}`}
        >
          <IconLayoutColumns size={16} stroke={2} aria-hidden />
          {t("mode.workspace")}
        </button>
        <button
          type="button" role="tab" aria-selected={inQA} disabled={disabled}
          onClick={onEnterQA}
          className={`${primaryBase} ${inQA ? on : off}`}
        >
          <IconMessages size={16} stroke={2} aria-hidden />
          {t("mode.qaArea")}
        </button>
      </div>

      {/* 2차 — 질문·분석 하위 뷰(질문·분석 영역일 때만) */}
      {inQA && (
        <div role="tablist" aria-label={t("nav.qaSub")} className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          {SUB_OPTIONS.map((opt) => {
            const selected = viewMode === opt.value;
            const { Icon } = opt;
            const label = t(opt.tKey);
            return (
              <button
                key={opt.value}
                type="button" role="tab" aria-selected={selected} aria-label={label} title={label} disabled={disabled}
                onClick={() => onViewModeChange(opt.value)}
                className={`flex items-center justify-center rounded-lg px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? on : off}`}
              >
                <Icon size={18} stroke={2} aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
