"use client";

// 코드/글 분석 자족 뷰(#773 서브3) — 워크스페이스 탭 안에 임베드되는 code/text 분석 화면.
// useCodeAnalysis 훅으로 인스턴스별 독립 상태를 갖고, 공유 데이터(히스토리·수집)는
// AnalysisContext에서 받는다(독립 모드와 같은 저장소). 좌우(세로 화면은 상하) 드래그 스플릿은
// AppShell과 동일 동작·동일 localStorage 키를 복제해 독립 모드와 비율이 일관되게 한다.
import { useEffect, useRef, useState } from "react";
import LearningPanel from "@/components/learning/LearningPanel";
import CodeInputArea from "@/components/translator/CodeInputArea";
import TextInputArea from "@/components/translator/TextInputArea";
import EditorChatColumn from "@/components/translator/EditorChatColumn";
import ChatRoom from "@/components/learning/ChatRoom";
import PanelEdgeToggle from "@/components/ui/PanelEdgeToggle";
import { useT } from "@/lib/i18n/I18nProvider";
import { useCodeAnalysis, generateAutoTitle } from "@/hooks/useCodeAnalysis";
import { useAnalysisContext } from "@/lib/analyze/AnalysisContext";

const SPLIT_STORAGE_KEY = "nunopi:split-left-pct";
const TOP_SPLIT_STORAGE_KEY = "nunopi:split-top-pct";
const DEFAULT_LEFT_PCT = 70;
const DEFAULT_TOP_PCT = 55;
const MIN_PCT = 25;
const MAX_PCT = 75;
const clampPct = (v: number) => Math.min(MAX_PCT, Math.max(MIN_PCT, v));

export default function CodeAnalysisView({ mode }: { mode: "code" | "text" }) {
  const t = useT();
  const shared = useAnalysisContext();
  // 탭 종류 = 모드 고정(code 탭=code, text 탭=text). 초기 모드로 고정 진입.
  const ca = useCodeAnalysis(shared, mode);
  const { providerId, historyEntries, excludedTerms } = shared;
  const currentEntry = historyEntries.find((e) => e.id === ca.currentHistoryId);
  const currentHistoryTitle = currentEntry?.title ?? (ca.analysisResult ? generateAutoTitle(ca.analysisResult, ca.code) : undefined);

  // ── 드래그 스플릿(AppShell 복제) — 넓은 화면=좌측 폭 %, 좁은 화면=위쪽 높이 %.
  const mainRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const [topPct, setTopPct] = useState(DEFAULT_TOP_PCT);
  const leftPctRef = useRef(DEFAULT_LEFT_PCT);
  const topPctRef = useRef(DEFAULT_TOP_PCT);
  const [isLandscape, setIsLandscape] = useState(true);
  const [dragging, setDragging] = useState(false);
  const pressRef = useRef<{ x: number; y: number; onButton: boolean } | null>(null);

  useEffect(() => {
    const storedLeft = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    if (Number.isFinite(storedLeft) && storedLeft >= MIN_PCT && storedLeft <= MAX_PCT) {
      leftPctRef.current = storedLeft;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLeftPct(storedLeft);
    }
    const storedTop = Number(localStorage.getItem(TOP_SPLIT_STORAGE_KEY));
    if (Number.isFinite(storedTop) && storedTop >= MIN_PCT && storedTop <= MAX_PCT) {
      topPctRef.current = storedTop;
      setTopPct(storedTop);
    }
    const mq = window.matchMedia("(orientation: landscape)");
    const apply = () => setIsLandscape(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => { document.body.style.userSelect = prev; };
  }, [dragging]);

  const hideEditorPane = ca.editorCollapsed && !ca.chatOpen;

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const onButton = (event.target as HTMLElement).closest("button") != null;
    pressRef.current = { x: event.clientX, y: event.clientY, onButton };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!hideEditorPane) setDragging(true);
  }
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !mainRef.current) return;
    const rect = mainRef.current.getBoundingClientRect();
    if (isLandscape) {
      if (rect.width === 0) return;
      const pct = clampPct(((event.clientX - rect.left) / rect.width) * 100);
      leftPctRef.current = pct;
      setLeftPct(pct);
    } else {
      if (rect.height === 0) return;
      const pct = clampPct(((event.clientY - rect.top) / rect.height) * 100);
      topPctRef.current = pct;
      setTopPct(pct);
    }
  }
  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    const press = pressRef.current;
    pressRef.current = null;
    if (press?.onButton) {
      const dist = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (dist < 5) { setDragging(false); ca.toggleEditorCollapsed(); return; }
    }
    if (!dragging) return;
    setDragging(false);
    try {
      if (isLandscape) localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(leftPctRef.current)));
      else localStorage.setItem(TOP_SPLIT_STORAGE_KEY, String(Math.round(topPctRef.current)));
    } catch {}
  }

  const editorNode = ca.mode === "text" ? (
    <TextInputArea
      code={ca.code}
      isLoading={ca.isLoading}
      onCodeChange={ca.handleCodeChange}
      chatOpen={ca.chatOpen}
      onToggleChat={() => ca.setChatOpen((v) => !v)}
      locked={ca.analysisResult != null}
      onClear={ca.handleClearInput}
      terms={ca.analysisResult?.terms ?? []}
      onTermClick={ca.setActiveTermId}
      providerId={providerId}
      onProviderChange={ca.handleProviderChange}
      onAnalyze={ca.handleAnalyze}
      onCancel={ca.handleCancel}
      resumable={ca.resumable && ca.analysisResult != null}
      onResume={ca.handleResume}
      errorMessage={ca.errorMessage}
    />
  ) : (
    <CodeInputArea
      code={ca.code}
      isLoading={ca.isLoading}
      languageChoice={ca.languageChoice}
      editorLanguage={ca.editorLanguage}
      onLanguageChoiceChange={ca.setLanguageChoice}
      onCodeChange={ca.handleCodeChange}
      activeLine={ca.activeLineLink?.line ?? null}
      onLineClick={ca.focusLineFromEditor}
      markedLines={ca.markedLines}
      chatOpen={ca.chatOpen}
      onToggleChat={() => ca.setChatOpen((v) => !v)}
      locked={ca.analysisResult != null}
      onClear={ca.handleClearInput}
      providerId={providerId}
      onProviderChange={ca.handleProviderChange}
      onAnalyze={ca.handleAnalyze}
      onCancel={ca.handleCancel}
      resumable={ca.resumable && ca.analysisResult != null}
      onResume={ca.handleResume}
      errorMessage={ca.errorMessage}
    />
  );

  return (
    <main ref={mainRef} className="flex w-full min-h-0 flex-1 flex-col landscape:flex-row">
      {/* 에디터(+챗) — 좌측 폭 % 또는 위쪽 높이 %. */}
      <div
        style={hideEditorPane ? undefined : isLandscape ? { width: `${leftPct}%` } : { height: `${topPct}%` }}
        className={`min-h-0 overflow-hidden border-zinc-200 dark:border-zinc-800 ${hideEditorPane ? "hidden" : ""}`}
      >
        <EditorChatColumn
          chatOpen={ca.chatOpen}
          editorCollapsed={ca.editorCollapsed}
          editor={editorNode}
          chat={
            <ChatRoom
              messages={ca.activeMessages}
              streaming={ca.chatStreaming}
              isLoading={ca.chatLoading}
              disabled={!ca.code.trim()}
              mode={ca.mode === "text" ? "text" : "code"}
              onSend={ca.handleSendChat}
              onClear={ca.handleClearChat}
              sessionIds={ca.chatSessions.map((s) => s.id)}
              activeSessionId={ca.activeSessionIdResolved}
              onSwitchSession={ca.handleSwitchSession}
              onNewSession={ca.handleNewSession}
              onDeleteSession={ca.handleDeleteSession}
              onCardAction={ca.handleChatCardAction}
            />
          }
        />
      </div>

      {/* 드래그 핸들 — 세로바(좌우) / 가로바(상하). 접힘이면 폭 0, 엣지 탭만. */}
      <div
        role="separator"
        aria-orientation={isLandscape ? "vertical" : "horizontal"}
        aria-label={t("layout.splitHandle")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative shrink-0 transition-colors ${
          hideEditorPane
            ? (isLandscape ? "w-0" : "h-0")
            : isLandscape
              ? `w-1.5 cursor-col-resize border-x border-zinc-200 dark:border-zinc-800 ${dragging ? "bg-blue-400/60" : "bg-zinc-100 hover:bg-blue-400/40 dark:bg-zinc-900"}`
              : `h-1.5 cursor-row-resize border-y border-zinc-200 dark:border-zinc-800 ${dragging ? "bg-blue-400/60" : "bg-zinc-100 hover:bg-blue-400/40 dark:bg-zinc-900"}`
        }`}
      >
        <PanelEdgeToggle
          collapsed={ca.editorCollapsed}
          collapsedDir={isLandscape ? "right" : "down"}
          orientation={isLandscape ? "vertical" : "horizontal"}
          title={t(ca.editorCollapsed ? "layout.expandEditor" : "layout.collapseEditor")}
          className={`absolute bg-zinc-100 dark:bg-[#15161d] border-zinc-200 dark:border-zinc-800 ${
            hideEditorPane
              ? (isLandscape ? "left-0 top-1/2 -translate-y-1/2 rounded-r-md border-y border-r" : "top-0 left-1/2 -translate-x-1/2 rounded-b-md border-x border-b")
              : `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border ${isLandscape ? "cursor-col-resize" : "cursor-row-resize"}`
          }`}
        />
      </div>

      {/* 학습 결과 패널 — 자체 세로 스크롤. */}
      <aside data-panel-scroll className="nunopi-scroll min-h-0 flex-1 overflow-y-scroll bg-white dark:bg-[#111219]">
        <LearningPanel
          providerId={providerId}
          mode={ca.mode}
          isLoading={ca.isLoading}
          onResumePartial={ca.handleResume}
          progressLine={ca.progressLine}
          analysisStartedAt={ca.analysisStartedAt}
          elapsedMs={ca.lastElapsedMs}
          chunkProgress={ca.chunkProgress}
          errorMessage={ca.errorMessage}
          result={ca.analysisResult}
          code={ca.code}
          activeTermId={ca.activeTermId}
          activeLine={ca.activeLineLink?.line ?? null}
          activeLineSource={ca.activeLineLink?.source}
          onLineFocus={ca.focusLineFromPanel}
          onFillLine={ca.fillLine}
          fillModalLine={ca.fillModalLine}
          onCloseFillModal={ca.closeFillModal}
          fillErrorLine={ca.fillErrorLine}
          pinnedLine={currentEntry?.pinnedLine ?? null}
          onPinLine={ca.handlePinLine}
          onMarkLines={ca.setMarkedLines}
          excludedTerms={excludedTerms}
          onExclude={ca.handleExclude}
          onDeleteToken={ca.handleDeleteToken}
          explainingTokens={ca.explainingTokens}
          onTokenExplain={ca.handleTokenExplain}
          onConceptExplain={ca.handleConceptExplain}
          onDeleteConcept={ca.handleDeleteConcept}
          explainingConcepts={ca.explainingConcepts}
          historyEntries={historyEntries}
          onRestoreHistory={ca.restoreHistory}
          onDeleteHistory={ca.handleDeleteHistory}
          onClearHistory={ca.handleClearHistory}
          onUpdateHistory={ca.handleUpdateHistory}
          currentHistoryId={ca.currentHistoryId}
          currentHistoryTitle={currentHistoryTitle}
          currentHistoryIsPinned={currentEntry?.isPinned ?? false}
          onSetCurrentTitle={(title) => { if (ca.currentHistoryId) ca.handleUpdateHistory(ca.currentHistoryId, { title: title || undefined }); }}
          onToggleCurrentPin={() => { if (ca.currentHistoryId && currentEntry) ca.handleUpdateHistory(ca.currentHistoryId, { isPinned: !currentEntry.isPinned }); }}
          collections={ca.visibleCollections}
          activeCollectionId={ca.activeCollectionId}
          onSelectCollection={ca.setActiveCollectionId}
          onCreateCollection={ca.handleCreateCollection}
          onDeleteCollection={ca.handleDeleteCollection}
          onToggleEntryCollection={ca.handleToggleEntryCollection}
        />
      </aside>
    </main>
  );
}
