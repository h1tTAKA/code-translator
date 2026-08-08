"use client";
// 워크스페이스 문서 멀티탭 뷰어(#693) — 여러 문서를 탭으로. 탭은 문서 브라우저서 클릭해 열림(+ 버튼 없음).
// 탭 바(파일명+닫기) + 우측 dock 컨트롤(영역/상하 토글) + 활성 DocPane(활성 파일로 remount).
import { IconX, IconFileText, IconTerminal2, IconFileCode, IconLayoutNavbar, IconLayoutBottombar } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import DocPane from "@/components/workspace/DocPane";

export default function DocViewer({ root, tabs, activeDoc, onActivate, onCloseTab, pos, onTogglePos, region, onToggleRegion }: {
  root: string;
  tabs: string[];        // 열린 문서 rel 경로들
  activeDoc: string;     // 현재 활성 문서
  onActivate: (file: string) => void;
  onCloseTab: (file: string) => void;
  pos?: "top" | "bottom"; onTogglePos?: () => void;         // 상하 분할 시만
  region?: "terminal" | "code"; onToggleRegion?: () => void; // 항상
}) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-6 dark:border-zinc-800 dark:bg-[#15161d]">
        {/* 탭 바(스크롤) */}
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((f) => {
            const on = f === activeDoc;
            const name = f.split("/").pop() ?? f;
            return (
              <div key={f} onClick={() => onActivate(f)}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-[#3B34E2] dark:bg-[#8b86f5]" aria-hidden />}
                <IconFileText size={13} stroke={2} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#8b86f5]" : "text-zinc-400"}`} aria-hidden />
                <span className="whitespace-nowrap">{name}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onCloseTab(f); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("mem.close")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {/* 우측 dock 컨트롤(탭 스크롤과 분리해 항상 보이게) */}
        {(onToggleRegion || onTogglePos) && (
          <div className="flex shrink-0 items-center gap-0.5 border-l border-zinc-200 px-1.5 dark:border-zinc-800">
            {onToggleRegion && (
              <button type="button" onClick={onToggleRegion} title={region === "code" ? t("workspace.docToTerminal") : t("workspace.docToCode")} className="rounded px-1 py-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
                {region === "code" ? <IconTerminal2 size={13} stroke={2} aria-hidden /> : <IconFileCode size={13} stroke={2} aria-hidden />}
              </button>
            )}
            {onTogglePos && (
              <button type="button" onClick={onTogglePos} title={pos === "top" ? t("workspace.docMoveBottom") : t("workspace.docMoveTop")} className="rounded px-1 py-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
                {pos === "top" ? <IconLayoutBottombar size={13} stroke={2} aria-hidden /> : <IconLayoutNavbar size={13} stroke={2} aria-hidden />}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <DocPane key={activeDoc} root={root} file={activeDoc} />
      </div>
    </div>
  );
}
