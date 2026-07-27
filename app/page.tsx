"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import ModeToggle from "@/components/layout/ModeToggle";
import LearningPanel from "@/components/learning/LearningPanel";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/ui/Toast";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { MESSAGES } from "@/lib/i18n/messages";
import CodeInputArea, { type LanguageChoice } from "@/components/translator/CodeInputArea";
import TextInputArea from "@/components/translator/TextInputArea";
import EditorChatColumn from "@/components/translator/EditorChatColumn";
import ChatRoom from "@/components/learning/ChatRoom";
import { createChatCard } from "@/lib/chatCard";
import { removeSuggestedCard, stripCardBlock, type SuggestedCard } from "@/lib/cardSuggestion";
import MemorizeView from "@/components/memorize/MemorizeView";
import AskView from "@/components/ask/AskView";
import HistoryView from "@/components/history/HistoryView";
import RepoView from "@/components/repo/RepoView";
import type { HistoryNav } from "@/lib/history/types";
import { type ViewMode, VIEW_MODE_KEY } from "@/lib/viewMode";
import { deckStats } from "@/lib/srs/due";
import { detectLanguage } from "@/lib/translator/detectLanguage";
import type { CodeToken } from "@/lib/translator/types";
import type { AgentAnalyzeResponse, AgentProviderKind, AnalyzeMode, ChatMessage, ProviderSettings } from "@/lib/agent";
import {
  type HistoryEntry,
  type ChatSession,
  saveToHistory,
  getAllHistory,
  deleteFromHistory,
  clearHistory,
  updateHistory,
  entryChatSessions,
  freshChatSessions,
  newSessionId,
} from "@/lib/historyDB";
import { loadExclusions, saveExclusions } from "@/lib/exclusions";
import { type Collection, loadCollections, saveCollections } from "@/lib/collections";

const SETTINGS_STORAGE_KEY = "nunopi:provider-settings";

// 토큰 카드 클릭/북마크 시 on-demand로 받는 뜻(#505/#509). 북마크 저장에 붙인다.
type TokenMeaning = { label: string; description: string; example?: string };

type AnalyzeStreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "partial"; providerId: AgentProviderKind; response: AgentAnalyzeResponse }
  | { type: "chunk-progress"; done: number; total: number }
  | { type: "result"; providerId: AgentProviderKind; response: AgentAnalyzeResponse }
  | { type: "error"; message: string };

interface AnalyzeApiErrorResponse {
  ok: false;
  error: {
    code:
      | "INVALID_REQUEST"
      | "PROVIDER_NOT_FOUND"
      | "PROVIDER_FAILED";
    message: string;
    providerId?: string;
  };
}

const DEFAULT_PROVIDER_ID: AgentProviderKind = "claude-agent";
const DEFAULT_CODE = `const [count, setCount] = useState(0);\n\nreturn <button className="px-4 py-2">{count}</button>;`;

function generateAutoTitle(result: import("@/lib/agent").AgentAnalyzeResponse, code: string): string {
  // 1순위: 모델이 뽑은 핵심 명사구 제목. 길면 컷.
  if (result.title?.trim()) {
    const t = result.title.trim();
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }
  // 2순위 폴백: 요약 앞부분(문장이라 핵심은 약하지만 제목 없을 때 최후).
  if (result.summary?.trim()) {
    const s = result.summary.trim();
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }
  const firstLine = code.trim().split(/\r?\n/)[0] ?? "";
  const preview = firstLine.length > 28 ? firstLine.slice(0, 28) + "…" : firstLine;
  return `${result.language}: ${preview}`;
}

export default function Home() {
  // 분석 모드(코드/글). 모드별로 입력을 따로 유지해 토글해도 서로 안 지워지게 한다.
  const [mode, setMode] = useState<AnalyzeMode>("code");
  const [codeInput, setCodeInput] = useState(DEFAULT_CODE);
  const [textInput, setTextInput] = useState("");
  const code = mode === "text" ? textInput : codeInput;
  // 최신 입력값의 ref 미러. Monaco가 readOnly 상태에서 value를 프로그램적으로 바꿀 때
  // 쏘는 onChange는 "직전 렌더에 구독된 stale 콜백"을 호출하므로(@monaco-editor/react의
  // value-effect가 onChange 재구독 effect보다 먼저 실행), state 클로저로는 최신값 비교가
  // 안 된다. ref는 클로저와 무관해 복원 시 동기 세팅하면 stale 콜백에서도 정확히 비교된다.
  const codeInputRef = useRef(codeInput);
  const textInputRef = useRef(textInput);
  const [providerId, setProviderId] = useState<AgentProviderKind>(
    DEFAULT_PROVIDER_ID,
  );
  const [isLoading, setIsLoading] = useState(false);
  // 분석 소요시간 — 시작 시각(진행 중 실시간 타이머용) + 직전 분석 총 소요(ms, 완료 메타용).
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  // 멈춤으로 부분 결과만 있는 상태 — "이어서 분석" 노출 조건.
  const [resumable, setResumable] = useState(false);
  // 청크 분석 진행률(완료/전체 조각) — 막대바용. 단일 호출이면 null.
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<AgentAnalyzeResponse | null>(null);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // 분석 출력 언어 — UI 언어(localStorage)와 동일. page는 I18nProvider 바깥이라 직접 읽는다.
  function getAnalysisLocale(): "ko" | "ja" | "en" {
    try {
      const l = localStorage.getItem("nunopi:locale");
      return l === "ja" || l === "en" ? l : "ko";
    } catch {
      return "ko";
    }
  }
  // 테마(라이트/다크) — 설정 드로어에서 토글. html.dark 클래스를 직접 토글하므로
  // Monaco/Shiki의 MutationObserver가 즉시 반응한다. (prepaint는 layout.tsx 스크립트가 처리.)
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
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [languageChoice, setLanguageChoice] = useState<LanguageChoice>("auto");
  // 진행 중인 분석을 멈추기 위한 AbortController 보관.
  const abortRef = useRef<AbortController | null>(null);
  // 모드(코드/글)별 분석 상태 스냅샷 — 모드 전환 시 저장/복원해 하던 분석 보존(#374).
  type AnalysisSnapshot = {
    analysisResult: AgentAnalyzeResponse | null;
    currentHistoryId: string | null;
    explainingTokens: string[];
    explainingConcepts: string[];
    chatSessions: ChatSession[];
    activeSessionId: string | null;
    chatStreaming: string | null;
    activeCollectionId: string | null;
    errorMessage: string | null;
    resumable: boolean;
    lastElapsedMs: number | null;
    chunkProgress: { done: number; total: number } | null;
  };
  const analysisSnapshotRef = useRef<Record<"code" | "text", AnalysisSnapshot | null>>({ code: null, text: null });
  // 분석 중 provider가 흘리는 최신 진행 출력 한 줄.
  const [progressLine, setProgressLine] = useState("");
  // 에디터 ↔ 학습패널 줄 링크. source로 양방향 동기화 루프를 끊는다.
  const [activeLineLink, setActiveLineLink] = useState<{
    line: number;
    source: "editor" | "panel";
  } | null>(null);
  const focusLineFromEditor = (line: number) =>
    setActiveLineLink({ line, source: "editor" });
  const focusLineFromPanel = (line: number) =>
    setActiveLineLink({ line, source: "panel" });
  // 토큰 호버/클릭으로 에디터에서 강조할 코드 줄들.
  const [markedLines, setMarkedLines] = useState<number[]>([]);
  // 제외(차단) 목록 — 글(IT 용어) 모드 전용. 코드 토큰은 X 삭제로 대체(제외 없음).
  const [excludedTerms, setExcludedTerms] = useState<string[]>([]);
  // 누락 줄 채우기(#633) — 유저가 설명 없는 줄 클릭 시 그 줄만 타겟 분석. 진행/실패 줄 번호.
  const [fillingLine, setFillingLine] = useState<number | null>(null);
  const [fillErrorLine, setFillErrorLine] = useState<number | null>(null);
  // 토큰 사전은 분석 시 token/category/lines만 채워지고, 뜻(label/description)은 카드 클릭 시
  // on-demand로 받아 병합한다(#505). explainingTokens는 로딩 표시용(토큰 텍스트).
  const [explainingTokens, setExplainingTokens] = useState<string[]>([]);
  const [explainingConcepts, setExplainingConcepts] = useState<string[]>([]);
  // 학습 챗 — 분석(히스토리 항목)마다 세션 목록(#312). chatStreaming은 타이핑 중 답변.
  const [chatOpen, setChatOpen] = useState(false);
  // 입력 패널 접기 — 학습패널 풀와이드(챗 열림 시 챗만 왼쪽 유지). localStorage 영속.
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  // 화면 전환 축(코드/글/암기). code·text는 분석 모드(mode)와 연동, memorize는 분석 안 함.
  const [viewMode, setViewMode] = useState<ViewMode>("code");
  // Ask 출처 이동 타깃(암기 갤러리 등에서). nonce로 재트리거.
  const [askGoTarget, setAskGoTarget] = useState<{ sessionId: string; subId?: string; quizId?: string; nonce: number } | undefined>(undefined);
  const askGoNonceRef = useRef(0);
  // 암기 카드 이동 타깃(전역 히스토리 카드챗 등). nonce로 재트리거.
  const [memGoTarget, setMemGoTarget] = useState<{ cardKey: string; nonce: number } | undefined>(undefined);
  const memGoNonceRef = useRef(0);
  // 암기 탭 배지 — 오늘 복습할 전체 due 수(0이면 숨김). 뷰 진입 시 갱신.
  const [memorizeDue, setMemorizeDue] = useState(0);
  // 암기 카드 추가 설명 생성 provider(분석 provider와 별개, 설정에서 지정). localStorage 영속.
  const [memorizeProviderId, setMemorizeProviderId] = useState<AgentProviderKind>(DEFAULT_PROVIDER_ID);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(freshChatSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatStreaming, setChatStreaming] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  // 활성 세션 — 명시 선택이 없으면 첫 세션. activeMessages는 ChatRoom에 전달.
  const activeSessionIdResolved = activeSessionId ?? chatSessions[0]?.id ?? null;
  const activeMessages = chatSessions.find((s) => s.id === activeSessionIdResolved)?.messages ?? [];
  // 사용자 목록(카테고리) — 분석결과 분류용. 정의는 localStorage, 멤버십은 HistoryEntry.collectionIds.
  const [collections, setCollections] = useState<Collection[]>([]);
  // 글 원문에서 클릭한 IT 용어 — 학습패널이 그 용어 카드로 스크롤(왼↔오 연결).
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  // 드롭다운이 "자동 감지"면 기존 detectLanguage로 추론, 아니면 선택값 그대로.
  // 에디터 하이라이팅 용도 — unknown은 typescript로 폴백(스니펫 대부분 JS/TS 계열).
  const editorLanguage: string = useMemo(() => {
    if (languageChoice !== "auto") return languageChoice;
    const detected = detectLanguage(code).primary;
    return detected === "unknown" ? "typescript" : detected;
  }, [code, languageChoice]);

  useEffect(() => {
    getAllHistory().then(setHistoryEntries).catch(() => {});
  }, []);

  // 접기 상태 복원/영속.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("nunopi:editor-collapsed") === "1") setEditorCollapsed(true);
    const storedView = localStorage.getItem(VIEW_MODE_KEY);
    if (storedView === "text" || storedView === "memorize" || storedView === "ask" || storedView === "history" || storedView === "repo") {

      setViewMode(storedView);
      if (storedView === "text") setMode("text");
    }
    const storedMemProvider = localStorage.getItem("nunopi:memorize-provider");
    if (storedMemProvider) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMemorizeProviderId(storedMemProvider as AgentProviderKind);
    }
  }, []);

  function handleMemorizeProviderChange(next: AgentProviderKind) {
    setMemorizeProviderId(next);
    try { localStorage.setItem("nunopi:memorize-provider", next); } catch { /* ignore */ }
  }

  // 암기 탭 배지 due 수 — 뷰 전환 시 재계산(localStorage는 클라에서만).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemorizeDue(deckStats("all", new Date()).due);
  }, [viewMode]);

  function handleViewModeChange(next: ViewMode) {
    if (next === viewMode) return;
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* ignore */ }
    // 코드/글은 분석 모드와 연동(암기는 분석 상태 보존).
    if (next === "code" || next === "text") handleModeChange(next);
  }
  function toggleEditorCollapsed() {
    setEditorCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("nunopi:editor-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // 입력 state → ref 미러 동기화. 편집·클리어·모드전환 등 일반 경로를 자동 커버.
  // (복원은 readOnly setValue 타이밍 탓에 핸들러에서 ref를 동기로 직접 세팅한다.)
  useEffect(() => { codeInputRef.current = codeInput; }, [codeInput]);
  useEffect(() => { textInputRef.current = textInput; }, [textInput]);

  // 현재 히스토리 항목의 result를 analysisResult와 동기화 — 태그로 불러온 토큰,
  // 개념 설명이 DB+메모리에 저장돼 다른 동작 후 돌아와도 그대로 유지된다.
  useEffect(() => {
    // 분석 중(이어서 partial 스트리밍 포함)엔 매 partial마다 DB write 하지 않는다 —
    // 완료/멈춤 시 명시적으로 저장/업데이트한다. on-demand 토큰·개념 append만 여기서 동기화.
    if (isLoading) return;
    if (!currentHistoryId || !analysisResult) return;
    const saved = analysisResult;
    updateHistory(currentHistoryId, { result: saved }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryEntries((prev) =>
      prev.map((e) => (e.id === currentHistoryId ? { ...e, result: saved } : e)),
    );
  }, [analysisResult, currentHistoryId, isLoading]);

  // 챗 세션도 현재 항목에 동기화 — 다른 거 보고 돌아와도 세션·활성탭 유지(#90/#312 패턴).
  useEffect(() => {
    if (!currentHistoryId) return;
    const saved = chatSessions;
    const activeId = activeSessionIdResolved ?? undefined;
    updateHistory(currentHistoryId, { chatSessions: saved, activeChatSessionId: activeId }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryEntries((prev) =>
      prev.map((e) => (e.id === currentHistoryId ? { ...e, chatSessions: saved, activeChatSessionId: activeId } : e)),
    );
  }, [chatSessions, activeSessionIdResolved, currentHistoryId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExcludedTerms(loadExclusions("text"));
     
    setCollections(loadCollections());
  }, []);

  // 목록은 분석 모드별로 분리한다(코드/글). explain·chat 등은 code로 묶음.
  const collectionMode: "code" | "text" = mode === "text" ? "text" : "code";
  // 현재 모드 목록만 표시(레거시=mode 없음은 code로 취급).
  const visibleCollections = collections.filter((c) => (c.mode ?? "code") === collectionMode);

  function handleCreateCollection(name: string): string {
    const id = crypto.randomUUID();
    setCollections((prev) => {
      const next = [...prev, { id, name, createdAt: new Date().toISOString(), mode: collectionMode }];
      saveCollections(next);
      return next;
    });
    return id;
  }

  function handleDeleteCollection(id: string) {
    setCollections((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCollections(next);
      return next;
    });
    setActiveCollectionId((cur) => (cur === id ? null : cur));
  }

  // 항목의 목록 멤버십 토글 — collectionIds 갱신(DB + 메모리, #90 패턴).
  function handleToggleEntryCollection(entryId: string, collectionId: string) {
    const entry = historyEntries.find((e) => e.id === entryId);
    if (!entry) return;
    const current = entry.collectionIds ?? [];
    const next = current.includes(collectionId)
      ? current.filter((c) => c !== collectionId)
      : [...current, collectionId];
    updateHistory(entryId, { collectionIds: next }).catch(() => {});
    setHistoryEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, collectionIds: next } : e)),
    );
  }

  // 제외는 글(IT 용어) 모드 전용.
  function handleExclude(_targetMode: AnalyzeMode, text: string) {
    setExcludedTerms((prev) => {
      const next = prev.includes(text) ? prev : [...prev, text];
      saveExclusions("text", next);
      return next;
    });
  }

  function handleRemoveExclusion(_targetMode: AnalyzeMode, text: string) {
    setExcludedTerms((prev) => {
      const next = prev.filter((t) => t !== text);
      saveExclusions("text", next);
      return next;
    });
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setProviderSettings(JSON.parse(raw) as ProviderSettings);
    } catch { /* ignore */ }
  }, []);

  function handleSettingsSave(next: ProviderSettings) {
    setProviderSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }

  useEffect(() => {
    if (isLoading) {
      document.title = "분석 중… — Nunopi";
    } else if (errorMessage) {
      document.title = "오류 — Nunopi";
    } else if (analysisResult) {
      document.title = "결과 도착 — Nunopi";
    } else {
      document.title = "Nunopi";
    }
  }, [isLoading, errorMessage, analysisResult]);

  function handleCodeChange(nextCode: string) {
    // Monaco는 value prop을 프로그램적으로 바꿔도(복원 등) onChange를 쏘고, 그 콜백은
    // stale 클로저라 state 비교는 옛 값과 비교돼 실패한다. ref로 현재 모드 입력값과 비교해
    // 무변화면 무시 — 복원이 방금 띄운 결과를 첫 클릭에 클리어하는 걸 막는다.
    // (복원은 현재 모드 항목만 대상이라 mode 변경이 없어 mode 클로저는 stale이 아니다.)
    const current = mode === "text" ? textInputRef.current : codeInputRef.current;
    if (nextCode === current) return;
    if (mode === "text") setTextInput(nextCode);
    else setCodeInput(nextCode);
    if (errorMessage) {
      setErrorMessage(null);
    }
    if (analysisResult) {
      setAnalysisResult(null);
    setExplainingTokens([]);
    setExplainingConcepts([]);
    setChatSessions(freshChatSessions());
    setActiveSessionId(null);
    setChatStreaming(null);
    }
    // 코드가 바뀌면 이전 부분 결과 기준 "이어서"는 무효.
    setResumable(false);
    // 결과가 사라지면 상단 제목/핀 헤더도 함께 비운다(이전 분석 제목 잔존 방지).
    setCurrentHistoryId(null);
  }

  function handleModeChange(nextMode: "code" | "text") {
    if (nextMode === mode) return;
    if (chatLoading) return; // 챗 스트리밍 중 세션 리셋 방지(진행 답변 유실 #312).
    // 떠나는 모드의 분석 상태를 스냅샷에 저장. (mode는 code/text만 — 분석 모드.)
    const fromMode: "code" | "text" = mode === "text" ? "text" : "code";
    analysisSnapshotRef.current[fromMode] = {
      analysisResult, currentHistoryId, explainingTokens, explainingConcepts,
      chatSessions, activeSessionId, chatStreaming, activeCollectionId,
      errorMessage, resumable, lastElapsedMs, chunkProgress,
    };
    setMode(nextMode);
    const snap = analysisSnapshotRef.current[nextMode];
    if (snap) {
      // 이전에 하던 그 모드의 분석 상태 복원.
      setAnalysisResult(snap.analysisResult);
      setCurrentHistoryId(snap.currentHistoryId);
      setExplainingTokens(snap.explainingTokens);
      setExplainingConcepts(snap.explainingConcepts);
      setChatSessions(snap.chatSessions);
      setActiveSessionId(snap.activeSessionId);
      setChatStreaming(snap.chatStreaming);
      setActiveCollectionId(snap.activeCollectionId);
      setErrorMessage(snap.errorMessage);
      setResumable(snap.resumable);
      setLastElapsedMs(snap.lastElapsedMs);
      setChunkProgress(snap.chunkProgress);
    } else {
      // 처음 가는 모드 — 초기화(기존 동작).
      setErrorMessage(null);
      setAnalysisResult(null);
      setCurrentHistoryId(null);
      setExplainingTokens([]);
      setExplainingConcepts([]);
      setChatSessions(freshChatSessions());
      setActiveSessionId(null);
      setChatStreaming(null);
      setActiveCollectionId(null);
      setResumable(false);
      setLastElapsedMs(null);
      setChunkProgress(null);
    }
  }

  function handleProviderChange(nextProviderId: AgentProviderKind) {
    if (chatLoading) return; // 챗 스트리밍 중 세션 리셋 방지(진행 답변 유실 #312).
    setProviderId(nextProviderId);
    if (errorMessage) {
      setErrorMessage(null);
    }
    if (analysisResult) {
      setAnalysisResult(null);
    }
    setCurrentHistoryId(null);
    setChatSessions(freshChatSessions());
    setActiveSessionId(null);
    setChatStreaming(null);
  }

  // 일반 분석은 () => runAnalyze(), 이어서 분석은 runAnalyze(이전 부분 결과).
  function handleAnalyze() {
    void runAnalyze();
  }
  function handleResume() {
    if (analysisResult) void runAnalyze(analysisResult);
  }

  async function runAnalyze(resumeFrom?: AgentAnalyzeResponse) {
    const nextCode = code.trim();

    if (!nextCode) {
      setErrorMessage(
        mode === "text"
          ? "분석할 글을 먼저 입력해야 한다."
          : "분석할 코드를 먼저 입력해야 한다.",
      );
      setAnalysisResult(null);
      return;
    }

    if (isLoading) {
      return;
    }
    // 챗 스트리밍 중엔 새 분석 금지 — 세션 리셋으로 진행 답변이 유실된다(#312).
    if (chatLoading) return;

    const startedAt = Date.now();
    setAnalysisStartedAt(startedAt);
    setLastElapsedMs(null);
    setResumable(false);
    setChunkProgress(null);
    setIsLoading(true);
    setErrorMessage(null);
    // 이어서 분석이면 기존 부분 결과·항목 id를 유지(스트리밍 누적 + 완료 시 그 항목 update).
    // 처음이면 비운다.
    if (!resumeFrom) {
      setAnalysisResult(null);
      setCurrentHistoryId(null);
    }
    setActiveTermId(null); // 이전 분석에서 클릭한 용어 선택 해제(stale 스크롤 방지).
    setProgressLine("");
    setExplainingTokens([]);
    setExplainingConcepts([]);
    if (!resumeFrom) {
      setChatSessions(freshChatSessions());
      setActiveSessionId(null);
      setChatStreaming(null);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // 이어서면 기존(복원/멈춤 저장) 항목을 이어 쓴다 → 완료/멈춤 시 그 항목을 update.
    // 처음이면 null로 시작해 완료 시 새로 save.
    const historyId: string | null = resumeFrom ? currentHistoryId : null;
    // 멈춤 시 저장할 최신 부분 결과(catch 클로저의 analysisResult는 stale이라 로컬로 잡는다).
    let lastPartial: AgentAnalyzeResponse | null = resumeFrom ?? null;

    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          request: {
            code: nextCode,
            locale: getAnalysisLocale(),
            providerId,
            mode,
            providerSettings,
            ...(resumeFrom ? { resumeFrom } : {}),
          },
        }),
        signal: controller.signal,
      });

      // 요청 검증 실패(4xx)는 JSON 에러. 정상 요청은 NDJSON 스트림으로 응답.
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as
          | AnalyzeApiErrorResponse
          | null;
        setAnalysisResult(null);
        setErrorMessage(result?.ok === false ? result.error.message : "분석 요청이 실패했다.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: AgentAnalyzeResponse | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: AnalyzeStreamEvent;
          try {
            event = JSON.parse(line) as AnalyzeStreamEvent;
          } catch {
            continue;
          }
          if (event.type === "progress") {
            setProgressLine(event.line);
          } else if (event.type === "partial") {
            // 청크 도착 순 점진 표시. lastPartial로 최신 부분 결과 추적(멈춤 저장용).
            lastPartial = event.response;
            setAnalysisResult(event.response);
          } else if (event.type === "chunk-progress") {
            setChunkProgress({ done: event.done, total: event.total });
          } else if (event.type === "result") {
            finalResult = event.response;
          } else if (event.type === "error") {
            streamError = event.message;
          }
        }
      }

      if (streamError) {
        setAnalysisResult(null);
        setErrorMessage(streamError);
        return;
      }

      if (finalResult) {
        const saved = finalResult;
        setLastElapsedMs(Date.now() - startedAt);
        setResumable(false);
        setAnalysisResult(saved);
        // 데스크톱 알림 — 분석 완료. 웹에선 nunopiDesktop 없어 스킵, 데스크톱은 창 포커스 중이면 main이 스킵.
        {
          const loc = getAnalysisLocale();
          const nTitle = MESSAGES[loc][mode === "code" ? "notify.codeDone" : "notify.textDone"];
          const nBody = saved.title || saved.summary?.slice(0, 80) || "";
          window.nunopiDesktop?.notify?.({ title: nTitle, body: nBody }).catch(() => {});
        }
        // 이어서/구간 채우기(resumeFrom)였다면, 이번에 새로 채워진 첫 줄로 스크롤+강조해
        // "어디가 채워졌는지" 보여준다(#507). source:"editor" → 패널이 그 카드로 스크롤.
        if (resumeFrom) {
          const priorLines = new Set((resumeFrom.lineExplanations ?? []).map((l) => l.line));
          const filled = (saved.lineExplanations ?? [])
            .map((l) => l.line)
            .filter((l) => !priorLines.has(l));
          if (filled.length > 0) focusLineFromEditor(Math.min(...filled));
        }
        if (historyId) {
          // 이어서/복원 항목 완성 → 같은 항목 업데이트(incomplete 해제, 제목 보존).
          const id = historyId;
          updateHistory(id, { result: saved, incomplete: false }).catch(() => {});
          setHistoryEntries((prev) =>
            prev.map((e) => (e.id === id ? { ...e, result: saved, incomplete: false } : e)),
          );
        } else {
          saveToHistory({
            code: nextCode,
            providerId,
            mode,
            result: saved,
            incomplete: false,
            title: generateAutoTitle(saved, nextCode),
            createdAt: new Date().toISOString(),
          }).then((savedId) => {
            setCurrentHistoryId(savedId);
            return getAllHistory();
          }).then(setHistoryEntries).catch(() => {});
        }
      }
    } catch (error) {
      // 유저가 멈추기를 누른 경우 — 부분 결과를 지우지 않고 그대로 둔다 + 히스토리에 미완 저장.
      // 부분 결과가 있으면 "이어서 분석" 가능(render에서 analysisResult와 함께 게이트).
      if (error instanceof DOMException && error.name === "AbortError") {
        setResumable(true);
        if (lastPartial) {
          const partial = lastPartial;
          if (historyId) {
            const id = historyId;
            updateHistory(id, { result: partial, incomplete: true }).catch(() => {});
            setHistoryEntries((prev) =>
              prev.map((e) => (e.id === id ? { ...e, result: partial, incomplete: true } : e)),
            );
          } else {
            saveToHistory({
              code: nextCode,
              providerId,
              mode,
              result: partial,
              incomplete: true,
              title: generateAutoTitle(partial, nextCode),
              createdAt: new Date().toISOString(),
            }).then((savedId) => {
              setCurrentHistoryId(savedId);
              return getAllHistory();
            }).then(setHistoryEntries).catch(() => {});
          }
        }
      } else {
        setAnalysisResult(null);
        setErrorMessage(formatFetchError(error));
      }
    } finally {
      abortRef.current = null;
      setAnalysisStartedAt(null);
      setChunkProgress(null);
      setProgressLine("");
      setIsLoading(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  // 누락 줄 채우기(#633) — 그 줄 주변 스니펫 + lineRange로 타겟 분석(청크 우회, 단일 호출).
  // 결과 lineExplanations를 기존에 병합(줄 dedup). reanchor는 LearningPanel이 렌더 시 적용.
  async function fillLine(line: number) {
    if (mode !== "code" || isLoading || fillingLine != null || !analysisResult) return;
    const codeLines = code.split(/\r?\n/);
    if (line < 1 || line > codeLines.length) return;
    // 맥락용 window(±3), 파일 경계 clamp. lineRange=클릭 줄 하나(그 줄만 설명 요청).
    const CTX = 3;
    const start = Math.max(1, line - CTX);
    const end = Math.min(codeLines.length, line + CTX);
    const snippet = codeLines.slice(start - 1, end).join("\n");
    setFillingLine(line);
    setFillErrorLine(null);
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          request: { code: snippet, locale: getAnalysisLocale(), providerId, mode: "code", providerSettings, lineRange: { start, end } },
        }),
      });
      if (!response.ok || !response.body) { setFillErrorLine(line); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", final: AgentAnalyzeResponse | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let ev: AnalyzeStreamEvent;
          try { ev = JSON.parse(l) as AnalyzeStreamEvent; } catch { continue; }
          if (ev.type === "result") final = ev.response;
          else if (ev.type === "partial") final = ev.response; // lineRange는 단일 호출이라 partial=최종에 근접
        }
      }
      const fresh = final?.lineExplanations ?? [];
      // 클릭한 줄을 채우는 설명이 하나도 없으면(주석·빈줄 등) 실패 표시.
      if (!fresh.some((le) => le.line === line)) { setFillErrorLine(line); return; }
      // 병합 — 기존에 없는 줄만 추가(중복 줄은 기존 유지). 줄 오름차순 정렬.
      setAnalysisResult((prev) => {
        if (!prev) return prev;
        const have = new Set((prev.lineExplanations ?? []).map((le) => le.line));
        const add = fresh.filter((le) => !have.has(le.line));
        if (add.length === 0) return prev;
        const merged = [...(prev.lineExplanations ?? []), ...add].sort((a, b) => a.line - b.line);
        const next = { ...prev, lineExplanations: merged };
        // 히스토리 항목 있으면 갱신(새로고침·복원 유지).
        if (currentHistoryId) {
          const id = currentHistoryId;
          updateHistory(id, { result: next }).catch(() => {});
          setHistoryEntries((entries) => entries.map((e) => (e.id === id ? { ...e, result: next } : e)));
        }
        return next;
      });
      focusLineFromEditor(line); // 채운 줄로 스크롤·강조
    } catch {
      setFillErrorLine(line);
    } finally {
      setFillingLine(null);
    }
  }

  // 토큰 카드 클릭 → 그 토큰의 뜻(label/description/example)을 on-demand로 받아 병합(#505).
  // 이미 설명이 있거나 로딩 중이면 무시. 등장 줄(lines)/category/id는 기존 것 유지.
  // 토큰 뜻을 on-demand로 받아 기존 토큰 카드에 병합하고, 받은 뜻을 반환한다(#505/#509).
  // 반환값은 북마크 시 "설명 붙여 저장"에 쓴다(#509). 이미 설명이 있으면 그걸 반환.
  async function handleTokenExplain(tokenText: string): Promise<TokenMeaning | null> {
    const existing = analysisResult?.tokens.find((t) => t.token === tokenText);
    if (existing?.description) {
      return { label: existing.label, description: existing.description, example: existing.example };
    }
    if (explainingTokens.includes(tokenText)) return null; // 이미 로딩 중
    const input = code.trim();
    if (!input) return null;
    setExplainingTokens((prev) => [...prev, tokenText]);
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          request: {
            code: input,
            locale: getAnalysisLocale(),
            providerId,
            mode: "explain-token",
            targetToken: tokenText,
            providerSettings,
          },
        }),
      });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fetched: CodeToken | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const event = JSON.parse(l) as AnalyzeStreamEvent;
            if (event.type === "result") fetched = event.response.tokens?.[0];
          } catch { /* skip */ }
        }
      }
      if (!fetched) return null;
      // 받아온 뜻만 기존 토큰 카드에 병합(lines/id/category 유지). 카드는 사전에 이미 있는
      // 토큰을 클릭한 것이므로, 그 사이 결과가 바뀌어 해당 토큰이 없어졌으면 그냥 무시한다
      // (없던 토큰을 lines=[]로 새로 추가하지 않음 — 빈 줄 토큰 불변식·stale 오염 방지).
      // 병합 결과를 잡아둔다(안전망 즉시저장에 재사용). 업데이터는 최신 prev 기준으로 안전하게 병합.
      // 저장 대상 항목은 지금(설명 요청 시점) 보고 있던 항목으로 고정 — fetch 도중 다른 항목으로 바뀌어도 그 항목에 안 씀.
      const targetHistoryId = currentHistoryId;
      let merged: AgentAnalyzeResponse | null = null;
      setAnalysisResult((prev) => {
        if (!prev || !prev.tokens.some((t) => t.token === tokenText)) return prev;
        merged = {
          ...prev,
          tokens: prev.tokens.map((t) =>
            t.token === tokenText
              ? { ...t, label: fetched!.label, description: fetched!.description, example: fetched!.example }
              : t,
          ),
        };
        return merged;
      });
      // 안전망(#537): 설명 붙인 결과를 그 자리서 히스토리에 즉시 저장(동기화 effect와 이중화).
      // id 없으면 기존 effect 자가치유에 맡긴다.
      if (merged && targetHistoryId) {
        const m = merged;
        updateHistory(targetHistoryId, { result: m }).catch(() => {});
        setHistoryEntries((prev) => prev.map((e) => (e.id === targetHistoryId ? { ...e, result: m } : e)));
      }
      return { label: fetched.label, description: fetched.description, example: fetched.example };
    } catch {
      return null; // on-demand explain 실패는 비치명적
    } finally {
      setExplainingTokens((prev) => prev.filter((t) => t !== tokenText));
    }
  }

  function handleDeleteToken(tokenText: string) {
    setAnalysisResult((prev) =>
      prev ? { ...prev, tokens: prev.tokens.filter((t) => t.token !== tokenText) } : prev,
    );
  }

  // 세션 sid에 메시지 1개 append.
  function appendToSession(sid: string, msg: ChatMessage) {
    setChatSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s)));
  }

  function handleSendChat(text: string) {
    if (chatLoading) return;
    const input = code.trim();
    const sid = activeSessionIdResolved;
    if (!sid) return;
    // 활성 세션에 질문 추가.
    const activeMsgs = chatSessions.find((s) => s.id === sid)?.messages ?? [];
    appendToSession(sid, { role: "user", content: text });
    // 에이전트에 보내는 맥락 — 다른 세션 전체 + 활성 세션 + 새 질문(전 세션 합본 참조, #312).
    // 답변은 활성 세션에만 쌓이고, 다른 세션은 읽기 전용 맥락으로만 쓰인다.
    const otherMsgs = chatSessions.filter((s) => s.id !== sid).flatMap((s) => s.messages);
    const contextMessages: ChatMessage[] = [...otherMsgs, ...activeMsgs, { role: "user", content: text }];
    setChatStreaming("");
    setChatLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            request: {
              code: input || "(코드 없음)",
              locale: getAnalysisLocale(),
              providerId,
              mode: "chat",
              messages: contextMessages,
              providerSettings,
            },
          }),
        });
        if (!res.ok || !res.body) {
          appendToSession(sid, { role: "assistant", content: "답변 요청이 실패했다." });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const event = JSON.parse(l) as AnalyzeStreamEvent;
              // codex는 진행 라벨만 흘리므로 타이핑에 안 씀(claude/openai만 전체 답 스트림).
              if (event.type === "progress" && providerId !== "codex-agent") {
                setChatStreaming(event.line);
              } else if (event.type === "result") {
                answer = event.response.summary;
              }
            } catch { /* skip */ }
          }
        }
        appendToSession(sid, { role: "assistant", content: answer || "(빈 응답)" });
      } catch {
        appendToSession(sid, { role: "assistant", content: "답변 중 오류가 발생했다." });
      } finally {
        setChatStreaming(null);
        setChatLoading(false);
      }
    })();
  }

  function handleClearChat() {
    // 활성 세션의 메시지만 비운다(다른 세션은 보존). 동기화 effect가 DB/메모리 반영.
    const sid = activeSessionIdResolved;
    setChatSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, messages: [] } : s)));
    setChatStreaming(null);
  }

  // 챗 카드 제안 칩 — 추가(위치 기준 store 저장) / 거절. 둘 다 그 메시지에서 블록 제거(칩 사라짐).
  // 반환: 카드를 실제로 새로 만들었으면 true, 중복이라 스킵했으면 false(칩 토스트 분기용 #511).
  function handleChatCardAction(messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }): boolean {
    const sid = activeSessionIdResolved;
    if (!sid) return false;
    let created = false;
    if (action.add) {
      // 분류는 에이전트가 판단한 kind 우선(용어 자체 성격) — 없으면 위치 기본값(코드=개념/글=IT용어).
      const kind = action.add.kind ?? (mode === "text" ? "term" : "concept");
      const title = historyEntries.find((e) => e.id === currentHistoryId)?.title
        ?? (analysisResult ? generateAutoTitle(analysisResult, code) : undefined);
      created = createChatCard(kind, action.add.term, action.add.definition, title, currentHistoryId ?? undefined, { kind: "analysis", sessionId: sid });
      setMemorizeDue(deckStats("all", new Date()).due); // 암기 배지 갱신
    }
    const addedTerm = action.add?.term;
    setChatSessions((prev) => prev.map((s) => {
      if (s.id !== sid) return s;
      return {
        ...s,
        messages: s.messages.map((m, i) =>
          i === messageIndex && m.role === "assistant"
            ? { ...m, content: addedTerm ? removeSuggestedCard(m.content, addedTerm) : stripCardBlock(m.content) }
            : m,
        ),
      };
    }));
    return created;
  }

  // 새 세션 추가 → 그 세션을 활성으로.
  function handleNewSession() {
    if (chatLoading) return;
    const sess: ChatSession = { id: newSessionId(), messages: [] };
    setChatSessions((prev) => [...prev, sess]);
    setActiveSessionId(sess.id);
  }

  // 세션 전환.
  function handleSwitchSession(id: string) {
    setActiveSessionId(id);
    setChatStreaming(null);
  }

  // 세션 삭제 — 마지막 1개는 못 지운다(항상 ≥1). 활성이 지워지면 남은 마지막 세션으로.
  function handleDeleteSession(id: string) {
    if (chatLoading) return;
    if (chatSessions.length <= 1) return;
    const next = chatSessions.filter((s) => s.id !== id);
    if (id === activeSessionIdResolved) setActiveSessionId(next[next.length - 1].id);
    setChatSessions(next);
    setChatStreaming(null);
  }

  // 입력 잠금(분석 결과 있을 때) 해제 — 입력을 비우고 깨끗한 새 분석 상태로.
  function handleClearInput() {
    if (chatLoading) return; // 챗 스트리밍 중 세션 리셋 방지(진행 답변 유실 #312).
    if (mode === "text") setTextInput("");
    else setCodeInput("");
    setAnalysisResult(null);
    setErrorMessage(null);
    setCurrentHistoryId(null);
    setChatSessions(freshChatSessions());
    setActiveSessionId(null);
    setChatStreaming(null);
    setExplainingTokens([]);
    setExplainingConcepts([]);
    setActiveLineLink(null);
    setMarkedLines([]);
    setActiveTermId(null);
  }

  function handleDeleteConcept(conceptId: string) {
    setAnalysisResult((prev) =>
      prev ? { ...prev, concepts: prev.concepts.filter((c) => c.conceptId !== conceptId) } : prev,
    );
  }

  // 개념 설명 on-demand 생성. 설명 문자열을 반환한다(북마크가 저장 전에 받아 붙이려고 — 토큰과 동일, #533).
  async function handleConceptExplain(conceptId: string, title: string): Promise<string | null> {
    if (explainingConcepts.includes(conceptId)) return null; // 이미 로딩 중
    const existing = analysisResult?.concepts.find((c) => c.conceptId === conceptId);
    if (existing?.description) return existing.description; // 이미 설명 있으면 재요청 없이 그거 반환
    const input = code.trim();
    if (!input) return null;
    setExplainingConcepts((prev) => [...prev, conceptId]);
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          request: {
            code: input,
            locale: getAnalysisLocale(),
            providerId,
            mode: "explain-concept",
            targetConcept: title,
            providerSettings,
          },
        }),
      });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let description: string | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const event = JSON.parse(l) as AnalyzeStreamEvent;
            if (event.type === "result") description = event.response.concepts?.[0]?.description;
          } catch { /* skip */ }
        }
      }
      if (!description) return null;
      const desc = description;
      // 받아온 설명을 화면 결과에도 병합(카드 패널 등에서 즉시 보이게). 병합 결과는 즉시저장에 재사용.
      // 저장 대상 항목은 요청 시점 항목으로 고정(fetch 도중 항목 전환 대비).
      const targetHistoryId = currentHistoryId;
      let merged: AgentAnalyzeResponse | null = null;
      setAnalysisResult((prev) => {
        if (!prev) return prev;
        merged = {
          ...prev,
          concepts: prev.concepts.map((c) =>
            c.conceptId === conceptId ? { ...c, description: desc } : c,
          ),
        };
        return merged;
      });
      // 안전망(#537): 설명 붙인 결과를 그 자리서 히스토리에 즉시 저장(동기화 effect와 이중화).
      if (merged && targetHistoryId) {
        const m = merged;
        updateHistory(targetHistoryId, { result: m }).catch(() => {});
        setHistoryEntries((prev) => prev.map((e) => (e.id === targetHistoryId ? { ...e, result: m } : e)));
      }
      return desc; // ← 북마크가 이 반환값을 저장 전에 붙인다
    } catch {
      return null; // on-demand explain 실패는 비치명적
    } finally {
      setExplainingConcepts((prev) => prev.filter((x) => x !== conceptId));
    }
  }

  function handleRestoreHistory(entry: HistoryEntry) {
    // 챗 응답 스트리밍 중엔 복원 금지 — 다른 항목 세션으로 덮어쓰면 진행 중 답변이 유실된다(#312).
    if (chatLoading) return;
    const entryMode = entry.mode ?? "code";
    // 복원 결과는 일회성 소요시간 표시 대상이 아니다 — stale 표시 방지.
    setLastElapsedMs(null);
    // 미완(멈춤) 항목이면 "이어서 분석" 가능.
    setResumable(Boolean(entry.incomplete));
    setMode(entryMode);
    setExplainingTokens([]);
    setExplainingConcepts([]);
    setChatStreaming(null);
    const sessions = entryChatSessions(entry);
    setChatSessions(sessions);
    setActiveSessionId(
      entry.activeChatSessionId && sessions.some((s) => s.id === entry.activeChatSessionId)
        ? entry.activeChatSessionId
        : sessions[0].id,
    );
    // ref를 동기로 먼저 세팅 — 복원 직후 입력이 locked(readOnly)가 되고, Monaco가 그
    // 상태에서 setValue로 쏘는 onChange(stale 콜백)가 결과를 클리어하지 못하게 한다.
    if (entryMode === "text") { textInputRef.current = entry.code; setTextInput(entry.code); }
    else { codeInputRef.current = entry.code; setCodeInput(entry.code); }
    setProviderId(entry.providerId);
    setAnalysisResult(entry.result);
    setErrorMessage(null);
    setActiveTermId(null); // 복원 시 이전 용어 선택 해제(다른 결과의 stale id 방지).
    setActiveCollectionId(null); // 다른 모드 항목 복원 시 이전 모드 목록 필터 해제.
    // 복원한 항목을 현재 결과로 지정 → 상단 제목/핀 헤더가 그 항목 기준으로 표시된다.
    setCurrentHistoryId(entry.id);
  }

  // 암기 카드 → 그 카드를 담은 분석 히스토리로 이동. 뷰를 코드/글로 전환하고 엔트리를 복원한다.
  // sessionId 주어지면(챗에서 생성된 카드) 그 챗 세션 활성화 + 챗 패널 열기.
  function handleGoToSource(sourceId: string, sessionId?: string) {
    const entry = historyEntries.find((e) => e.id === sourceId);
    if (!entry) return; // 히스토리 20개 캡에 밀려 삭제됐으면 조용히 무시(버튼도 안 뜨는 게 정상).
    handleViewModeChange((entry.mode ?? "code") === "text" ? "text" : "code");
    handleRestoreHistory(entry);
    if (sessionId) {
      const sessions = entryChatSessions(entry);
      if (sessions.some((s) => s.id === sessionId)) setActiveSessionId(sessionId);
      setChatOpen(true); // 그 챗룸을 바로 볼 수 있게 패널 열기
    }
  }

  // 암기 갤러리 등에서 질문(Ask) 카드 "출처로 가기" — Ask 모드로 전환 + 세션·질문 타깃 전달.
  function handleGoToAskSource(sessionId: string, subId?: string, quizId?: string) {
    setAskGoTarget({ sessionId, subId, quizId, nonce: askGoNonceRef.current + 1 });
    askGoNonceRef.current += 1;
    handleViewModeChange("ask");
  }

  // 전역 히스토리 이벤트 클릭 → 그 활동 지점으로(#565). nav.mode·필드로 기존 핸들러에 분기.
  function handleGoToHistory(nav: HistoryNav) {
    if (nav.mode === "ask" && nav.sessionId) handleGoToAskSource(nav.sessionId, nav.subId, nav.quizId);
    else if ((nav.mode === "code" || nav.mode === "text") && nav.sourceId) handleGoToSource(nav.sourceId, nav.sessionId);
    else if (nav.mode === "memorize") {
      if (nav.cardKey) { setMemGoTarget({ cardKey: nav.cardKey, nonce: memGoNonceRef.current + 1 }); memGoNonceRef.current += 1; }
      handleViewModeChange("memorize");
    } else handleViewModeChange(nav.mode);
  }

  function handleDeleteHistory(id: string) {
    deleteFromHistory(id).then(() => getAllHistory()).then(setHistoryEntries).catch(() => {});
    // 지금 화면에 보고 있는 분석을 지웠으면 화면(입력+결과)도 비운다 — 안 그러면 삭제했는데 그대로 남음.
    if (id === currentHistoryId) handleClearInput();
  }

  function handleClearHistory() {
    // 현재 모드의 히스토리만 삭제하고 목록을 다시 읽어 다른 모드 항목은 보존한다.
    clearHistory(mode).then(() => getAllHistory()).then(setHistoryEntries).catch(() => {});
  }

  function handleUpdateHistory(
    id: string,
    changes: Partial<Pick<import("@/lib/historyDB").HistoryEntry, "isPinned" | "title">>,
  ) {
    updateHistory(id, changes)
      .then(() => getAllHistory())
      .then(setHistoryEntries)
      .catch(() => {});
  }

  return (
    <I18nProvider>
    <ConfirmProvider>
    <ToastProvider>
      <AppShell
        onOpenSettings={() => setIsSettingsOpen(true)}
        editorCollapsed={editorCollapsed}
        chatOpen={chatOpen}
        onToggleEditorCollapsed={toggleEditorCollapsed}
        memorize={viewMode === "memorize"}
        memorizeView={<MemorizeView active={viewMode === "memorize"} providerId={memorizeProviderId} providerSettings={providerSettings} sourceIds={new Set(historyEntries.map((e) => e.id))} onGoToSource={handleGoToSource} onGoToAskSource={handleGoToAskSource} goToCard={memGoTarget} />}
        ask={viewMode === "ask"}
        askView={<AskView active={viewMode === "ask"} providerId={providerId} providerSettings={providerSettings} goToTarget={askGoTarget} />}
        history={viewMode === "history"}
        historyView={<HistoryView active={viewMode === "history"} onNavigate={handleGoToHistory} providerId={providerId} providerSettings={providerSettings} />}
        repo={viewMode === "repo"}
        repoView={<RepoView active={viewMode === "repo"} providerId={providerId} providerSettings={providerSettings} />}
        modeToggle={
          <ModeToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            disabled={isLoading}
            memorizeBadge={memorizeDue}
          />
        }
        learningPanel={
        <LearningPanel
          providerId={providerId}
          mode={mode}
          isLoading={isLoading}
          onResumePartial={handleResume}
          progressLine={progressLine}
          analysisStartedAt={analysisStartedAt}
          elapsedMs={lastElapsedMs}
          chunkProgress={chunkProgress}
          errorMessage={errorMessage}
          result={analysisResult}
          code={code}
          activeTermId={activeTermId}
          activeLine={activeLineLink?.line ?? null}
          activeLineSource={activeLineLink?.source}
          onLineFocus={focusLineFromPanel}
          onFillLine={fillLine}
          fillingLine={fillingLine}
          fillErrorLine={fillErrorLine}
          onMarkLines={setMarkedLines}
          excludedTerms={excludedTerms}
          onExclude={handleExclude}
          onDeleteToken={handleDeleteToken}
          explainingTokens={explainingTokens}
          onTokenExplain={handleTokenExplain}
          onConceptExplain={handleConceptExplain}
          onDeleteConcept={handleDeleteConcept}
          explainingConcepts={explainingConcepts}
          historyEntries={historyEntries}
          onRestoreHistory={handleRestoreHistory}
          onDeleteHistory={handleDeleteHistory}
          onClearHistory={handleClearHistory}
          onUpdateHistory={handleUpdateHistory}
          currentHistoryId={currentHistoryId}
          currentHistoryTitle={
            historyEntries.find(e => e.id === currentHistoryId)?.title
            // 미저장 분석이면 히스토리 제목이 없으므로 결과에서 확정 제목을 만든다(북마크 출처용).
            ?? (analysisResult ? generateAutoTitle(analysisResult, code) : undefined)
          }
          currentHistoryIsPinned={historyEntries.find(e => e.id === currentHistoryId)?.isPinned ?? false}
          onSetCurrentTitle={(title) => { if (currentHistoryId) handleUpdateHistory(currentHistoryId, { title: title || undefined }); }}
          onToggleCurrentPin={() => {
            const entry = historyEntries.find(e => e.id === currentHistoryId);
            if (currentHistoryId && entry) handleUpdateHistory(currentHistoryId, { isPinned: !entry.isPinned });
          }}
          collections={visibleCollections}
          activeCollectionId={activeCollectionId}
          onSelectCollection={setActiveCollectionId}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
          onToggleEntryCollection={handleToggleEntryCollection}
        />
      }
        editor={
          <EditorChatColumn
            chatOpen={chatOpen}
            editorCollapsed={editorCollapsed}
            editor={
              mode === "text" ? (
                <TextInputArea
                  code={code}
                  isLoading={isLoading}
                  onCodeChange={handleCodeChange}
                  chatOpen={chatOpen}
                  onToggleChat={() => setChatOpen((v) => !v)}
                  locked={analysisResult != null}
                  onClear={handleClearInput}
                  terms={analysisResult?.terms ?? []}
                  onTermClick={setActiveTermId}
                  providerId={providerId}
                  onProviderChange={handleProviderChange}
                  onAnalyze={handleAnalyze}
                  onCancel={handleCancel}
                  resumable={resumable && analysisResult != null}
                  onResume={handleResume}
                  errorMessage={errorMessage}
                />
              ) : (
                <CodeInputArea
                  code={code}
                  isLoading={isLoading}
                  languageChoice={languageChoice}
                  editorLanguage={editorLanguage}
                  onLanguageChoiceChange={setLanguageChoice}
                  onCodeChange={handleCodeChange}
                  activeLine={activeLineLink?.line ?? null}
                  onLineClick={focusLineFromEditor}
                  markedLines={markedLines}
                  chatOpen={chatOpen}
                  onToggleChat={() => setChatOpen((v) => !v)}
                  locked={analysisResult != null}
                  onClear={handleClearInput}
                  providerId={providerId}
                  onProviderChange={handleProviderChange}
                  onAnalyze={handleAnalyze}
                  onCancel={handleCancel}
                  resumable={resumable && analysisResult != null}
                  onResume={handleResume}
                  errorMessage={errorMessage}
                />
              )
            }
            chat={
              <ChatRoom
                messages={activeMessages}
                streaming={chatStreaming}
                isLoading={chatLoading}
                disabled={!code.trim()}
                mode={mode === "text" ? "text" : "code"}
                onSend={handleSendChat}
                onClear={handleClearChat}
                sessionIds={chatSessions.map((s) => s.id)}
                activeSessionId={activeSessionIdResolved}
                onSwitchSession={handleSwitchSession}
                onNewSession={handleNewSession}
                onDeleteSession={handleDeleteSession}
                onCardAction={handleChatCardAction}
              />
            }
          />
        }
      />
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={providerSettings}
        onSave={handleSettingsSave}
        excludedTerms={excludedTerms}
        onRemoveExclusion={handleRemoveExclusion}
        theme={theme}
        onThemeChange={changeTheme}
        memorizeProviderId={memorizeProviderId}
        onMemorizeProviderChange={handleMemorizeProviderChange}
      />
    </ToastProvider>
    </ConfirmProvider>
    </I18nProvider>
  );
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "분석 요청 중 알 수 없는 오류가 발생했다.";
}
