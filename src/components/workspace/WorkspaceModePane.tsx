"use client";

import type { ReactNode } from "react";
import { IconMessages, IconFileCode, IconFileText, IconBrain } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

// 모드 탭 컨테이너(#769) — 질문/코드분석/글분석을 워크스페이스 탭 안에 임베드하는 자리.
// 이 커밋은 스텁(구현 예정 표시). 실제 뷰 임베드(AskView / CodeInputArea+LearningPanel /
// TextInputArea+LearningPanel)는 서브2·서브3에서. 헤더 슬롯(tabStrip)은 레포 탭과 동일하게 받아
// 활성 탭이 모드일 때도 탭 바가 그대로 보이게 한다(끌어올리기 없이 시각 일관).
export type ModeKind = "ask" | "code" | "text";

const META: Record<ModeKind, { Icon: typeof IconMessages; labelKey: string }> = {
  ask: { Icon: IconMessages, labelKey: "mode.ask" },
  code: { Icon: IconFileCode, labelKey: "mode.code" },
  text: { Icon: IconFileText, labelKey: "mode.text" },
};

export default function WorkspaceModePane({ kind, tabStrip, onExitWorkspace, onOpenMemorize }: {
  kind: ModeKind;
  tabStrip?: ReactNode;
  onExitWorkspace?: () => void;
  onOpenMemorize?: () => void;
}) {
  const t = useT();
  const { Icon, labelKey } = META[kind];
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 헤더 한 줄 — 레포 탭 헤더와 시각 일관(border-b). 좌: 탭 스트립, 우: 공통 영역 컨트롤. */}
      <header className="flex items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800">
        {tabStrip}
        {(onExitWorkspace || onOpenMemorize) && <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
        {onExitWorkspace && (
          <button type="button" onClick={onExitWorkspace} title={t("workspace.toQA")} aria-label={t("workspace.toQA")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconMessages size={16} stroke={2} aria-hidden />
          </button>
        )}
        {onOpenMemorize && (
          <button type="button" onClick={onOpenMemorize} title={t("mode.memorize")} aria-label={t("mode.memorize")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconBrain size={16} stroke={2} aria-hidden />
          </button>
        )}
      </header>
      {/* 본문 — 스텁. 서브2·3에서 실제 모드 뷰로 교체. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:text-[#8b86f5]">
            <Icon size={26} stroke={1.75} aria-hidden />
          </div>
          <p className="text-[14px] font-semibold text-zinc-700 dark:text-zinc-200">{t(labelKey)}</p>
          <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("workspace.modeStub")}</p>
        </div>
      </div>
    </div>
  );
}
