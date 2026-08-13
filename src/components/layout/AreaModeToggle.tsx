"use client";

import { IconCode, IconFileText, IconMessage2, IconLayoutColumns, IconMessages, IconBrain } from "@tabler/icons-react";
import type { ViewMode } from "@/lib/viewMode";
import { useT } from "@/lib/i18n/I18nProvider";

// 공통 세그먼트 스타일.
const SEG_WRAP = "inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900";
const SEG_ON = "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50";
const SEG_OFF = "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200";

// ── 1차: 큰 세 영역(워크스페이스 | 질문·분석 | 암기). 스트립 우측에 배치(#725). ──
interface AreaPrimaryToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // 1차 "질문·분석" 클릭 — 직전 하위뷰로 복귀(enterQAArea).
  onEnterQA: () => void;
  // 암기 세그 배지 — 오늘 복습 due 수(0이면 숨김).
  memorizeBadge?: number;
  disabled?: boolean;
}

export default function AreaPrimaryToggle({ viewMode, onViewModeChange, onEnterQA, memorizeBadge = 0, disabled = false }: AreaPrimaryToggleProps) {
  const t = useT();
  const isWorkspace = viewMode === "workspace";
  const isMemorize = viewMode === "memorize";
  const isHistory = viewMode === "history"; // 홈(전역 대시보드) — 로고 진입, 영역 중립(#729)
  const inQA = !isWorkspace && !isMemorize && !isHistory; // 질문·분석 하위뷰(질문·코드·글)일 때만
  const base = "flex h-6 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <div role="tablist" aria-label={t("nav.area")} className={SEG_WRAP}>
      <button type="button" role="tab" aria-selected={isWorkspace} disabled={disabled}
        onClick={() => onViewModeChange("workspace")}
        className={`${base} ${isWorkspace ? SEG_ON : SEG_OFF}`}>
        <IconLayoutColumns size={16} stroke={2} aria-hidden />
        {t("mode.workspace")}
      </button>
      <button type="button" role="tab" aria-selected={inQA} disabled={disabled}
        onClick={onEnterQA}
        className={`${base} ${inQA ? SEG_ON : SEG_OFF}`}>
        <IconMessages size={16} stroke={2} aria-hidden />
        {t("mode.qaArea")}
      </button>
      <button type="button" role="tab" aria-selected={isMemorize} disabled={disabled}
        onClick={() => onViewModeChange("memorize")}
        className={`${base} ${isMemorize ? SEG_ON : SEG_OFF}`}>
        <IconBrain size={16} stroke={2} aria-hidden />
        {t("mode.memorize")}
        {memorizeBadge > 0 && (
          <span aria-label={`${t("mem.modeDue")} ${memorizeBadge}`}
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white">
            {memorizeBadge > 99 ? "99+" : memorizeBadge}
          </span>
        )}
      </button>
    </div>
  );
}

// ── 2차: 질문·분석 하위 뷰(질문·코드분석·글분석). 스트립 가운데에 배치(#725). ──
// memorize는 상시 퀵, 홈(history)은 로고 진입 전역 대시보드(#729)라 여기 없음.
const SUB_OPTIONS: { value: ViewMode; tKey: string; Icon: typeof IconCode }[] = [
  { value: "ask", tKey: "mode.ask", Icon: IconMessage2 },
  { value: "code", tKey: "mode.code", Icon: IconCode },
  { value: "text", tKey: "mode.text", Icon: IconFileText },
];

interface QASubToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  disabled?: boolean;
}

export function QASubToggle({ viewMode, onViewModeChange, disabled = false }: QASubToggleProps) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t("nav.qaSub")} className={SEG_WRAP}>
      {SUB_OPTIONS.map((opt) => {
        const selected = viewMode === opt.value;
        const { Icon } = opt;
        const label = t(opt.tKey);
        return (
          <button key={opt.value} type="button" role="tab" aria-selected={selected} aria-label={label} title={label} disabled={disabled}
            onClick={() => onViewModeChange(opt.value)}
            className={`flex h-6 items-center justify-center rounded-lg px-6 transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? SEG_ON : SEG_OFF}`}>
            <Icon size={16} stroke={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
