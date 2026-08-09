"use client";

import { IconX } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

// 갤러리 위 중앙 오버레이 모달 셸 — AgentDeckHubModal과 같은 톤(백드롭 클릭 닫힘, 중앙 패널).
// 부모가 relative여야 absolute inset-0가 갤러리 영역을 덮는다. 복습 통계·복습 암기 모달이 공유.
export default function MemModal({
  title, onClose, children, panelClassName,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // 패널 크기 커스터마이즈(기본: 최대 900px). 통계/덱선택이 필요 폭 다를 때.
  panelClassName?: string;
}) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative flex max-h-[86vh] w-[min(94vw,900px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0b0c10] ${panelClassName ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          <button
            type="button" onClick={onClose} aria-label={t("mem.exit")}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <IconX size={16} stroke={2} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
