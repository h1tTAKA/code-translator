"use client";

import { IconCode, IconFileText, IconBrain, IconMessage2, IconHome, IconLayoutColumns } from "@tabler/icons-react";
import type { ViewMode } from "@/lib/viewMode";
import { useT } from "@/lib/i18n/I18nProvider";

interface ModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  disabled?: boolean;
  // 암기 탭 배지 — 오늘 복습 due 수(0이면 숨김).
  memorizeBadge?: number;
}

const MODE_OPTIONS: { value: ViewMode; tKey: string; Icon: typeof IconCode }[] = [
  { value: "history", tKey: "mode.history", Icon: IconHome },
  { value: "ask", tKey: "mode.ask", Icon: IconMessage2 },
  { value: "workspace", tKey: "mode.workspace", Icon: IconLayoutColumns },
  { value: "code", tKey: "mode.code", Icon: IconCode },
  { value: "text", tKey: "mode.text", Icon: IconFileText },
  { value: "memorize", tKey: "mode.memorize", Icon: IconBrain },
];

// 헤더 정중앙 — 코드/글/암기 뷰 전환. (히스토리·북마크는 모드별 분리, Issue 76.)
export default function ModeToggle({ viewMode, onViewModeChange, disabled = false, memorizeBadge = 0 }: ModeToggleProps) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label="화면 모드"
      className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
    >
      {MODE_OPTIONS.map((opt) => {
        const selected = viewMode === opt.value;
        const { Icon } = opt;
        const label = t(opt.tKey);
        const showBadge = opt.value === "memorize" && memorizeBadge > 0;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onViewModeChange(opt.value)}
            className={`relative flex items-center justify-center rounded-lg px-7 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <Icon size={18} stroke={2} aria-hidden />
            {showBadge && (
              <span
                aria-label={`오늘 복습 ${memorizeBadge}`}
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white"
              >
                {memorizeBadge > 99 ? "99+" : memorizeBadge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
