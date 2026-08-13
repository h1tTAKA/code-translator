"use client";

import type { ReactNode } from "react";
import { IconMessages, IconBrain, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useEditorCollapsed } from "@/hooks/useEditorCollapsed";
import AskView from "@/components/ask/AskView";
import CodeAnalysisView from "@/components/analyze/CodeAnalysisView";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

// 모드 탭 컨테이너(#769) — 질문/코드분석/글분석을 워크스페이스 탭 안에 임베드하는 자리.
// 질문=AskView(#771), 코드분석·글분석=CodeAnalysisView(#773). 헤더 슬롯(tabStrip)은 레포 탭과
// 동일하게 받아 활성 탭이 모드일 때도 탭 바가 그대로 보이게 한다(끌어올리기 없이 시각 일관).
export type ModeKind = "ask" | "code" | "text";

export default function WorkspaceModePane({ kind, tabStrip, active, providerId, providerSettings, onExitWorkspace, onOpenMemorize }: {
  kind: ModeKind;
  tabStrip?: ReactNode;
  active?: boolean;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onExitWorkspace?: () => void;
  onOpenMemorize?: () => void;
}) {
  const t = useT();
  const fullscreen = useFullscreen(); // 타이틀바 통합(#779) — 신호등 자리 좌측 패딩 토글
  const [editorCollapsed, toggleEditorCollapsed] = useEditorCollapsed(); // 입력 패널 접기(#781) — 헤더 토글
  const isAnalyze = kind === "code" || kind === "text";
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 헤더 한 줄 — 레포 탭 헤더와 시각 일관(border-b). 좌: nunopi lockup 로고를 레포 도크 툴바와 동일한
          폭(≈161px = pl 6 + 버튼5×28 + 구분선 5 + gap 10)으로 두어(#771), 레포↔모드 탭 전환에도 탭
          스트립 시작점이 안 밀리게. 로고는 왼쪽 정렬, 나머지는 여백. 우: 공통 영역 컨트롤. */}
      <header className={`titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800 ${fullscreen ? "" : "pl-[78px]"}`}>
        <div className="flex w-[161px] shrink-0 items-center pl-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/nunopi-lockup-light.png" alt="nunopi" className="block h-7 w-auto -translate-y-0.5 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/nunopi-lockup-transparent.png" alt="nunopi" className="hidden h-7 w-auto -translate-y-0.5 dark:block" />
          {/* 코드/글 분석 탭이면 입력 패널 접기 토글(#781) — 로고 옆 바짝. 독립 모드(AppShell)와 동일 위치·크기. */}
          {isAnalyze && (
            <button type="button" onClick={toggleEditorCollapsed}
              title={t(editorCollapsed ? "layout.expandEditor" : "layout.collapseEditor")}
              aria-label={t(editorCollapsed ? "layout.expandEditor" : "layout.collapseEditor")}
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              {editorCollapsed ? <IconLayoutSidebarLeftExpand size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarLeftCollapse size={18} stroke={2} aria-hidden />}
            </button>
          )}
        </div>
        <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
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
      {/* 본문 — 질문=AskView(#771), 코드분석·글분석=CodeAnalysisView(#773). 공유 히스토리·수집은
          AnalysisContext(page.tsx 소유)에서 받아 독립 모드와 같은 저장소를 본다. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {kind === "ask" ? (
          <AskView active={active} providerId={providerId} providerSettings={providerSettings} />
        ) : (
          // key={kind} — mode는 초기값이라, 만일 kind가 바뀌면 인스턴스를 새로 만들어 훅 상태를 재초기화.
          <CodeAnalysisView key={kind} mode={kind} editorCollapsed={editorCollapsed} />
        )}
      </div>
    </div>
  );
}
