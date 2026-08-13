"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import AreaPrimaryToggle, { QASubToggle } from "@/components/layout/AreaModeToggle";
import LearningPanel from "@/components/learning/LearningPanel";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/ui/Toast";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import CodeInputArea from "@/components/translator/CodeInputArea";
import TextInputArea from "@/components/translator/TextInputArea";
import EditorChatColumn from "@/components/translator/EditorChatColumn";
import ChatRoom from "@/components/learning/ChatRoom";
import MemorizeView from "@/components/memorize/MemorizeView";
import AskView from "@/components/ask/AskView";
import HistoryView from "@/components/history/HistoryView";
import WorkspaceTabs from "@/components/workspace/WorkspaceTabs";
import type { HistoryNav } from "@/lib/history/types";
import { type ViewMode, VIEW_MODE_KEY } from "@/lib/viewMode";
import { deckStats } from "@/lib/srs/due";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";
import { type HistoryEntry, getAllHistory } from "@/lib/historyDB";
import { loadExclusions } from "@/lib/exclusions";
import { type Collection, loadCollections } from "@/lib/collections";
import { useCodeAnalysis, generateAutoTitle } from "@/hooks/useCodeAnalysis";
import { useEditorCollapsed } from "@/hooks/useEditorCollapsed";
import { AnalysisProvider } from "@/lib/analyze/AnalysisContext";

const SETTINGS_STORAGE_KEY = "nunopi:provider-settings";
const DEFAULT_PROVIDER_ID: AgentProviderKind = "claude-agent";

export default function Home() {
  // ── 전역 공유 상태(page 소유 — 암기·질문·기록·설정 등 여러 뷰가 쓴다). code/text 분석 로직은 useCodeAnalysis 훅.
  const [providerId, setProviderId] = useState<AgentProviderKind>(DEFAULT_PROVIDER_ID);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 테마(라이트/다크) — html.dark 클래스를 직접 토글해 Monaco/Shiki MutationObserver가 즉시 반응.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const stored = localStorage.getItem("nunopi:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(isDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  function changeTheme(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try { localStorage.setItem("nunopi:theme", next); } catch {}
  }

  // 카드보기 날아오는 애니메이션 on/off (#641).
  const [cardFlyAnimation, setCardFlyAnimation] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCardFlyAnimation(localStorage.getItem("nunopi:card-fly") !== "off");
  }, []);
  function changeCardFlyAnimation(next: boolean) {
    setCardFlyAnimation(next);
    try { localStorage.setItem("nunopi:card-fly", next ? "on" : "off"); } catch {}
  }

  // 분석 히스토리(암기·기록 뷰와 공유). 목록·제외 용어(설정·글분석 공유)도 여기 소유.
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [excludedTerms, setExcludedTerms] = useState<string[]>([]);

  // 화면 전환 축(코드/글/암기/질문/기록/워크스페이스).
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  const lastQAViewRef = useRef<ViewMode>("code"); // 질문·분석 진입 시 복귀할 직전 하위뷰(ask/code/text).
  const [askGoTarget, setAskGoTarget] = useState<{ sessionId: string; subId?: string; quizId?: string; nonce: number } | undefined>(undefined);
  const askGoNonceRef = useRef(0);
  const [memGoTarget, setMemGoTarget] = useState<{ cardKey: string; nonce: number } | undefined>(undefined);
  const memGoNonceRef = useRef(0);
  const [memorizeDue, setMemorizeDue] = useState(0);
  const [memorizeProviderId, setMemorizeProviderId] = useState<AgentProviderKind>(DEFAULT_PROVIDER_ID);

  // ── 코드/글 분석 로직(훅). 공유 상태를 주입한다. shared는 워크스페이스 탭의 CodeAnalysisView가
  // Context로 받아 같은 저장소를 보게 하는 통로이기도 하다(#773).
  const shared = useMemo(() => ({ historyEntries, setHistoryEntries, collections, setCollections, excludedTerms, setExcludedTerms, providerId, setProviderId, providerSettings, setMemorizeDue }), [historyEntries, setHistoryEntries, collections, setCollections, excludedTerms, setExcludedTerms, providerId, setProviderId, providerSettings, setMemorizeDue]);
  const ca = useCodeAnalysis(shared);
  // 입력 패널 접힘(#781) — 훅 밖으로 끌어올려 헤더 토글이 제어. 코드/글 분석 화면에서만 의미.
  const [editorCollapsed, toggleEditorCollapsed] = useEditorCollapsed();

  // 히스토리 최초 로드.
  useEffect(() => { getAllHistory().then(setHistoryEntries).catch(() => {}); }, []);

  // 뷰·모드·암기 provider 복원.
  useEffect(() => {
    const storedView = localStorage.getItem(VIEW_MODE_KEY);
    if (storedView === "text" || storedView === "memorize" || storedView === "ask" || storedView === "history" || storedView === "workspace") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode(storedView);
      if (storedView === "text") ca.setMode("text");
    }
    const storedMemProvider = localStorage.getItem("nunopi:memorize-provider");
    if (storedMemProvider) setMemorizeProviderId(storedMemProvider as AgentProviderKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 제외·목록 로드.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExcludedTerms(loadExclusions("text"));
    setCollections(loadCollections());
  }, []);

  // 분석 설정 로드.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setProviderSettings(JSON.parse(raw) as ProviderSettings);
    } catch { /* ignore */ }
  }, []);

  // 암기 탭 배지 due 수 — 뷰 전환 시 재계산.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemorizeDue(deckStats("all", new Date()).due);
  }, [viewMode]);

  function handleMemorizeProviderChange(next: AgentProviderKind) {
    setMemorizeProviderId(next);
    try { localStorage.setItem("nunopi:memorize-provider", next); } catch { /* ignore */ }
  }

  function handleViewModeChange(next: ViewMode) {
    if (next === viewMode) return;
    if (next === "ask" || next === "code" || next === "text") lastQAViewRef.current = next;
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* ignore */ }
    // 코드/글은 분석 모드와 연동(암기는 분석 상태 보존).
    if (next === "code" || next === "text") ca.handleModeChange(next);
  }
  const enterQAArea = () => handleViewModeChange(lastQAViewRef.current);

  function handleSettingsSave(next: ProviderSettings) {
    setProviderSettings(next);
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // 암기 카드 → 그 카드를 담은 분석 히스토리로 이동. 뷰 전환 + 엔트리 복원(훅).
  function handleGoToSource(sourceId: string, sessionId?: string) {
    const entry = historyEntries.find((e) => e.id === sourceId);
    if (!entry) return;
    handleViewModeChange((entry.mode ?? "code") === "text" ? "text" : "code");
    ca.restoreHistory(entry);
    if (sessionId) ca.openChatSession(entry, sessionId);
  }

  function handleGoToAskSource(sessionId: string, subId?: string, quizId?: string) {
    setAskGoTarget({ sessionId, subId, quizId, nonce: askGoNonceRef.current + 1 });
    askGoNonceRef.current += 1;
    handleViewModeChange("ask");
  }

  function handleGoToHistory(nav: HistoryNav) {
    if (nav.mode === "ask" && nav.sessionId) handleGoToAskSource(nav.sessionId, nav.subId, nav.quizId);
    else if ((nav.mode === "code" || nav.mode === "text") && nav.sourceId) handleGoToSource(nav.sourceId, nav.sessionId);
    else if (nav.mode === "memorize") {
      if (nav.cardKey) { setMemGoTarget({ cardKey: nav.cardKey, nonce: memGoNonceRef.current + 1 }); memGoNonceRef.current += 1; }
      handleViewModeChange("memorize");
    } else handleViewModeChange(nav.mode);
  }

  const currentEntry = historyEntries.find((e) => e.id === ca.currentHistoryId);
  const currentHistoryTitle = currentEntry?.title ?? (ca.analysisResult ? generateAutoTitle(ca.analysisResult, ca.code) : undefined);

  return (
    <AnalysisProvider value={shared}>
    <I18nProvider>
    <ConfirmProvider>
    <ToastProvider>
      <AppShell
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogoClick={() => handleViewModeChange("history")}
        editorCollapsed={editorCollapsed}
        chatOpen={ca.chatOpen}
        onToggleEditorCollapsed={toggleEditorCollapsed}
        showEditorToggle={viewMode === "code" || viewMode === "text"}
        memorize={viewMode === "memorize"}
        memorizeView={<MemorizeView active={viewMode === "memorize"} providerId={memorizeProviderId} providerSettings={providerSettings} sourceIds={new Set(historyEntries.map((e) => e.id))} onGoToSource={handleGoToSource} onGoToAskSource={handleGoToAskSource} goToCard={memGoTarget} />}
        ask={viewMode === "ask"}
        askView={<AskView active={viewMode === "ask"} providerId={providerId} providerSettings={providerSettings} goToTarget={askGoTarget} />}
        history={viewMode === "history"}
        historyView={<HistoryView active={viewMode === "history"} onNavigate={handleGoToHistory} providerId={providerId} providerSettings={providerSettings} />}
        workspace={viewMode === "workspace"}
        workspaceView={<WorkspaceTabs active={viewMode === "workspace"} providerId={providerId} providerSettings={providerSettings} onExitWorkspace={enterQAArea} onOpenMemorize={() => handleViewModeChange("memorize")} onOpenSettings={() => setIsSettingsOpen(true)} />}
        modeToggle={
          <AreaPrimaryToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            onEnterQA={enterQAArea}
            memorizeBadge={memorizeDue}
            disabled={ca.isLoading}
          />
        }
        subToggle={
          <QASubToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            disabled={ca.isLoading}
          />
        }
        learningPanel={
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
      }
        editor={
          <EditorChatColumn
            chatOpen={ca.chatOpen}
            editorCollapsed={editorCollapsed}
            editor={
              ca.mode === "text" ? (
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
              )
            }
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
        }
      />
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        variant={viewMode === "workspace" ? "modal" : "drawer"}
        settings={providerSettings}
        onSave={handleSettingsSave}
        excludedTerms={excludedTerms}
        onRemoveExclusion={ca.handleRemoveExclusion}
        theme={theme}
        onThemeChange={changeTheme}
        cardFlyAnimation={cardFlyAnimation}
        onCardFlyAnimationChange={changeCardFlyAnimation}
        memorizeProviderId={memorizeProviderId}
        onMemorizeProviderChange={handleMemorizeProviderChange}
      />
    </ToastProvider>
    </ConfirmProvider>
    </I18nProvider>
    </AnalysisProvider>
  );
}
