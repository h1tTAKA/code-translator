"use client";

import { useEffect, useRef, useState } from "react";
import { IconSettings } from "@tabler/icons-react";
import PanelEdgeToggle from "@/components/ui/PanelEdgeToggle";
import { useT } from "@/lib/i18n/I18nProvider";

interface AppShellProps {
  editor: React.ReactNode;
  learningPanel: React.ReactNode;
  modeToggle?: React.ReactNode;
  // 질문·분석 하위 세그(홈·질문·코드·글) — 스트립 가운데 배치(#725). modeToggle(1차)은 우측.
  subToggle?: React.ReactNode;
  onOpenSettings: () => void;
  // 입력 패널 접기 — 접힘+챗닫힘이면 왼쪽 영역을 통째로 숨겨 학습패널 풀와이드.
  // 접힘+챗열림이면 영역은 유지(내용은 EditorChatColumn이 챗만 렌더).
  editorCollapsed?: boolean;
  chatOpen?: boolean;
  onToggleEditorCollapsed?: () => void;
  // 암기 모드 — true면 에디터/학습패널 스플릿 대신 memorizeView를 전폭 렌더.
  memorize?: boolean;
  memorizeView?: React.ReactNode;
  // 에이전트 질문(ask) 모드 — true면 askView를 전폭 렌더(memorize와 배타).
  ask?: boolean;
  askView?: React.ReactNode;
  // 전역 학습 히스토리(home) 모드 — true면 historyView 전폭 렌더(다른 뷰와 배타).
  history?: boolean;
  historyView?: React.ReactNode;
  // 워크스페이스 모드 — true면 workspaceView 전폭 렌더(다른 뷰와 배타).
  workspace?: boolean;
  workspaceView?: React.ReactNode;
}

// 가로형 창(landscape — 정상/4분할): 좌(에디터)/우(학습패널) 스플릿 — leftPct.
// 세로형 창(portrait — 세로 2분할/폰): 위(에디터)/아래(학습패널) 스플릿 — topPct.
// 두 축 모두 뷰포트 고정(앱형) + 사이 핸들 드래그로 배분, 비율은 localStorage 영속.
const SPLIT_STORAGE_KEY = "nunopi:split-left-pct";
const TOP_SPLIT_STORAGE_KEY = "nunopi:split-top-pct";
const DEFAULT_LEFT_PCT = 70;
const DEFAULT_TOP_PCT = 55;
const MIN_PCT = 25;
const MAX_PCT = 75;

function clampPct(value: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

export default function AppShell({ editor, learningPanel, modeToggle, subToggle, onOpenSettings, editorCollapsed = false, chatOpen = false, onToggleEditorCollapsed, memorize = false, memorizeView, ask = false, askView, history = false, historyView, workspace = false, workspaceView }: AppShellProps) {
  const t = useT();
  const mainRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const [topPct, setTopPct] = useState(DEFAULT_TOP_PCT);
  // 최신 값을 항상 보유 — pointerup 시 클로저 stale 없이 영속화하기 위함.
  const leftPctRef = useRef(DEFAULT_LEFT_PCT);
  const topPctRef = useRef(DEFAULT_TOP_PCT);
  const [isLandscape, setIsLandscape] = useState(true);
  const [dragging, setDragging] = useState(false);
  // 클릭 vs 드래그 판별 — pointerdown 시점 기록(좌표 + 접기 버튼 위에서 시작했는지).
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

  // 드래그 중 텍스트 선택을 막아 끌기 경험을 깔끔하게 한다.
  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [dragging]);

  // 접힘+챗닫힘 — 왼쪽 영역 자체가 없으므로 드래그(비율 조절)는 무의미.
  const hideEditorPane = editorCollapsed && !chatOpen;

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const onButton = (event.target as HTMLElement).closest("button") != null;
    pressRef.current = { x: event.clientX, y: event.clientY, onButton };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!hideEditorPane) setDragging(true); // 접힘+챗닫힘은 드래그 없음(클릭 판정만)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !mainRef.current) return;
    const rect = mainRef.current.getBoundingClientRect();
    if (isLandscape) {
      // 가로 스플릿 — X 기준 좌측 폭 %.
      if (rect.width === 0) return;
      const pct = clampPct(((event.clientX - rect.left) / rect.width) * 100);
      leftPctRef.current = pct;
      setLeftPct(pct);
    } else {
      // 세로 스플릿 — Y 기준 위쪽 높이 %.
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
    // 버튼에서 눌러 거의 안 움직였으면 클릭 = 접기/펼치기 토글.
    if (press?.onButton) {
      const dist = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (dist < 5) {
        setDragging(false);
        onToggleEditorCollapsed?.();
        return;
      }
    }
    if (!dragging) return;
    setDragging(false);
    try {
      if (isLandscape) {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(leftPctRef.current)));
      } else {
        localStorage.setItem(TOP_SPLIT_STORAGE_KEY, String(Math.round(topPctRef.current)));
      }
    } catch {}
  }

  return (
    <div className="relative flex h-screen min-h-0 flex-col bg-white dark:bg-[#111219]">
      {/* 질문·분석 영역: full-width 헤더 바 대신 얇은 상단 스트립에 우측 정렬 pill(모드 토글+설정) — orca식.
          투명 배경·최소 높이라 옛 헤더보다 얇고, 콘텐츠는 아래로 흘러 뷰 툴바와 안 겹침(#723). 워크스페이스는 자체 컨트롤(#721)이라 미표시. */}
      {!workspace && (
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-zinc-200 px-4 py-1.5 dark:border-zinc-800">
          {/* 좌: 브랜드 로고(짤린 느낌 방지·균형). 라이트=네이비, 다크=흰 워드마크. */}
          <span className="flex shrink-0 items-center justify-self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nunopi-lockup-light.png" alt="Nunopi" className="block h-7 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nunopi-lockup-transparent.png" alt="Nunopi" className="hidden h-7 w-auto dark:block" />
          </span>
          {/* 가운데: 질문·분석 하위 세그(홈·질문·코드·글) — 원래 중앙 위치(#725). 암기 뷰에선 숨김(하위 없음). */}
          <div className="justify-self-center">{!memorize && subToggle}</div>
          {/* 우: 영역 전환 토글(워크스페이스│질문·분석│암기) │ 설정(테두리 없는 아이콘) */}
          <div className="flex items-center gap-1.5 justify-self-end">
            {modeToggle}
            {/* 영역 nav ↔ 유틸 구분선 */}
            <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
            <button type="button" onClick={onOpenSettings} title={t("header.settings")} aria-label={t("header.settings")}
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              <IconSettings size={18} stroke={2} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* 암기 뷰 — 항상 마운트하고 비활성 시 hidden(세션/카드 상태 보존 #374).
          Tailwind flex와 hidden 충돌 때문에 display를 조건부 클래스로 토글. */}
      <main className={`w-full min-h-0 flex-1 flex-col overflow-y-auto ${memorize ? "flex" : "hidden"}`}>
        {memorizeView}
      </main>

      {/* 에이전트 질문(ask) 뷰 — 항상 마운트, 비활성 시 hidden(상태 보존). */}
      <main className={`w-full min-h-0 flex-1 flex-col overflow-hidden ${ask ? "flex" : "hidden"}`}>
        {askView}
      </main>

      {/* 전역 학습 히스토리(home) 뷰 — 항상 마운트, 비활성 시 hidden. */}
      <main className={`w-full min-h-0 flex-1 flex-col overflow-hidden ${history ? "flex" : "hidden"}`}>
        {historyView}
      </main>

      {/* 워크스페이스 뷰 — 항상 마운트, 비활성 시 hidden(상태 보존). */}
      <main className={`w-full min-h-0 flex-1 flex-col overflow-hidden ${workspace ? "flex" : "hidden"}`}>
        {workspaceView}
      </main>

      {/* 분석(코드/글) 스플릿 — 암기·질문·홈·워크스페이스 중엔 hidden. */}
      <main
        ref={mainRef}
        className={`w-full min-h-0 flex-1 flex-col landscape:flex-row ${memorize || ask || history || workspace ? "hidden" : "flex"}`}
      >
        {/* 에디터 — 넓은 화면은 좌측 폭 %, 좁은 화면은 위쪽 높이 %. Monaco가 내부 스크롤 처리. */}
        <div
          style={hideEditorPane ? undefined : isLandscape ? { width: `${leftPct}%` } : { height: `${topPct}%` }}
          className={`min-h-0 overflow-hidden border-zinc-200 dark:border-zinc-800 ${hideEditorPane ? "hidden" : ""}`}
        >
          {editor}
        </div>

        {/* 드래그 핸들 — 넓은 화면은 세로바(좌우 배분), 좁은 화면은 가로바(상하 배분). */}
        <div
          role="separator"
          aria-orientation={isLandscape ? "vertical" : "horizontal"}
          aria-label={t("layout.splitHandle")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`relative shrink-0 transition-colors ${
            // 접힘(hideEditorPane)이면 폭 0·투명 — 워크스페이스처럼 fat 바 없이 탭만 엣지에 뜨게(#697). 펼침이면 드래그 바.
            hideEditorPane
              ? (isLandscape ? "w-0" : "h-0")
              : isLandscape
                ? `w-1.5 cursor-col-resize border-x border-zinc-200 dark:border-zinc-800 ${dragging ? "bg-blue-400/60" : "bg-zinc-100 hover:bg-blue-400/40 dark:bg-zinc-900"}`
                : `h-1.5 cursor-row-resize border-y border-zinc-200 dark:border-zinc-800 ${dragging ? "bg-blue-400/60" : "bg-zinc-100 hover:bg-blue-400/40 dark:bg-zinc-900"}`
          }`}
        >
          {onToggleEditorCollapsed && (
            // 공통 엣지 탭(#697 통일). onToggle 없음 — 클릭 판정은 separator handlePointerUp(closest("button"))이 담당.
            // 접힘: 엣지에 도킹(rounded 한쪽) — 워크스페이스 스타일. 펼침: 드래그 바 중앙.
            <PanelEdgeToggle
              collapsed={editorCollapsed}
              collapsedDir={isLandscape ? "right" : "down"}
              orientation={isLandscape ? "vertical" : "horizontal"}
              title={t(editorCollapsed ? "layout.expandEditor" : "layout.collapseEditor")}
              className={`absolute bg-zinc-100 dark:bg-[#15161d] border-zinc-200 dark:border-zinc-800 ${
                hideEditorPane
                  ? (isLandscape ? "left-0 top-1/2 -translate-y-1/2 rounded-r-md border-y border-r" : "top-0 left-1/2 -translate-x-1/2 rounded-b-md border-x border-b")
                  : `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border ${isLandscape ? "cursor-col-resize" : "cursor-row-resize"}`
              }`}
            />
          )}
        </div>

        {/* 학습패널 — 자체 세로 스크롤. data-panel-scroll: 안쪽 박스(forwardPanelWheel)가 wheel을 이 컨테이너로 넘긴다. */}
        <aside
          data-panel-scroll
          className="nunopi-scroll min-h-0 flex-1 overflow-y-scroll bg-white dark:bg-[#111219]"
        >
          {learningPanel}
        </aside>
      </main>
    </div>
  );
}
