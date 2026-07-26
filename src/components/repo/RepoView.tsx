"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSitemap, IconFolderOpen, IconLoader2, IconAlertTriangle, IconRadar, IconEye, IconRefresh, IconShare3, IconLayoutGrid, IconStack2, IconLayoutBoardSplit, IconSparkles } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import RepoGraphView, { LARGE_GRAPH_NODES } from "@/components/repo/RepoGraphView";
import type { LayoutMode } from "@/lib/repo/layout";
import RepoNodePanel from "@/components/repo/RepoNodePanel";
import RepoOverviewPanel from "@/components/repo/RepoOverviewPanel";
import { communityColor } from "@/lib/repo/colors";
import { blastRadius } from "@/lib/repo/blast";
import { repoOverview } from "@/lib/repo/overview";
import { downloadText, graphToDot } from "@/lib/repo/export";
import type { RepoGraph } from "@/lib/repo/types";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";

const REPO_PATH_KEY = "nunopi:repo-path";

// 레이아웃 모드 토글 메타 — grid(관계)·layers(흐름)·treemap(덩치) 전부 활성.
const LAYOUT_META: { mode: LayoutMode; Icon: typeof IconLayoutGrid; labelKey: string; enabled: boolean }[] = [
  { mode: "grid", Icon: IconLayoutGrid, labelKey: "repo.layoutGrid", enabled: true },
  { mode: "layers", Icon: IconStack2, labelKey: "repo.layoutLayers", enabled: true },
  { mode: "treemap", Icon: IconLayoutBoardSplit, labelKey: "repo.layoutTreemap", enabled: true },
];
const REPO_GRAPH_KEY = "nunopi:repo-graph"; // 최근 1개 경로의 그래프 결과 캐시

// 캐시된 그래프 — 저장된 경로와 같을 때만 반환(다르면 재분석 필요).
function readGraphCache(path: string): RepoGraph | null {
  try {
    const raw = localStorage.getItem(REPO_GRAPH_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { path: string; graph: RepoGraph };
    if (obj.path !== path) return null;
    if (!obj.graph.communities) return null; // 커뮤니티 없는 옛 캐시 = stale → 재분석
    return obj.graph;
  } catch { return null; }
}
function writeGraphCache(path: string, graph: RepoGraph) {
  try { localStorage.setItem(REPO_GRAPH_KEY, JSON.stringify({ path, graph })); } catch { /* quota 무시 */ }
}

// 레포 분석 모드 — 로컬 레포 폴더 → 아키텍처 그래프 + 노드 클릭 설명(부모 #585).
export default function RepoView({ active = true, providerId, providerSettings }: { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings }) {
  const t = useT();
  const { locale } = useLocale();
  const [path, setPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 노드별 LLM 설명 캐시(재클릭 시 재생성 X).
  const [explains, setExplains] = useState<Record<string, string>>({});
  // 노드별 챗 스레드 캐시(전환·닫기 후 복귀 시 유지).
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  // 숨긴 그룹(폴더) — 필터 칩 토글.
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  // 숨긴 커뮤니티 — 좌 커뮤니티 리스트 토글.
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<number>>(new Set());
  // LLM 기능 라벨 — 커뮤니티 id → AI 이름(온디맨드·캐시).
  const [communityNames, setCommunityNames] = useState<Record<number, string>>({});
  const [naming, setNaming] = useState(false);
  // 영향도(블래스트) 모드 — 켜면 선택 노드의 의존자를 거리별 색으로.
  const [blastMode, setBlastMode] = useState(false);
  // 그래프 배치 모드(grid/layers/treemap).
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  // "한눈에" 온보딩 패널 표시 + 쉬운 말 요약 캐시(패널 닫아도 유지).
  const [showOverview, setShowOverview] = useState(false);
  const [overviewSummary, setOverviewSummary] = useState<string | null>(null);
  // 새로고침 후 "N개 재분석" 잠깐 표시(증분 체감).
  const [reparsedNote, setReparsedNote] = useState<number | null>(null);
  const reparsedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reparsedTimerRef.current) clearTimeout(reparsedTimerRef.current); }, []);
  // 마운트 후에만 window(Electron) 판별 — 서버/클라 초기 렌더 일치(하이드레이션 불일치 방지).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회 플래그(SSR 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 재방문 복원 — 저장 경로 있으면: 캐시된 그래프는 즉시, 없으면 재분석.
  useEffect(() => {
    if (!mounted) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(REPO_PATH_KEY); } catch { /* ignore */ }
    if (!saved) return;
    const cached = readGraphCache(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 복원용 초기 세팅
    setPath(saved);
    if (cached) {
      setGraph(cached);
    } else {
      void analyze(saved);
    }
  }, [mounted]);

  async function analyze(target: string, opts?: { note?: boolean }) {
    setAnalyzing(true);
    setGraph(null);
    setError(null);
    setSelectedId(null);
    setExplains({});
    setChats({});
    setHiddenGroups(new Set());
    setHiddenCommunities(new Set());
    setCommunityNames({});
    setBlastMode(false);
    setShowOverview(false);
    setOverviewSummary(null);
    try {
      const res = await fetch("/api/repo/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "failed"); return; }
      setGraph(data as RepoGraph);
      try { localStorage.setItem(REPO_PATH_KEY, target); } catch { /* ignore */ }
      writeGraphCache(target, data as RepoGraph);
      if (opts?.note) {
        // 새로고침(증분) 후 재파싱 개수 잠깐 표시. 이전 타이머 정리(연타 중첩 방지).
        setReparsedNote((data as RepoGraph).stats.reparsed ?? null);
        if (reparsedTimerRef.current) clearTimeout(reparsedTimerRef.current);
        reparsedTimerRef.current = setTimeout(() => setReparsedNote(null), 4000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handlePick() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const res = await desktop.pickRepoFolder();
      if (!res.canceled && res.path) { setPath(res.path); void analyze(res.path); }
    } catch { /* 무시 */ } finally {
      setPicking(false);
    }
  }

  // 새로고침 — 캐시 무시하고 현재 경로 재분석(파일 바뀌었을 때).
  const handleRefresh = () => { if (path && !analyzing) void analyze(path, { note: true }); };

  const folderName = path ? path.split("/").filter(Boolean).pop() ?? path : null;

  // 그래프 → Graphviz DOT 다운로드(외부 툴서 열기·재렌더 가능. 스크린샷과 달리 구조 데이터).
  const handleExportDot = () => {
    if (graph) downloadText(`${folderName ?? "repo"}-graph.dot`, graphToDot(graph));
  };
  const showGraph = !!graph && !analyzing;

  // 그룹(폴더) 목록 + 개수 + 색 — 필터 칩용.
  // 커뮤니티 리스트(색·라벨·개수) — 좌 패널. 크기순(graph.communities는 이미 정렬).
  const communityList = useMemo(
    () => (graph?.communities ?? []).map((c) => ({ ...c, color: communityColor(c.id) })),
    [graph],
  );
  const toggleCommunity = (id: number) => setHiddenCommunities((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // 커뮤니티 기능 라벨 — 각 커뮤니티 대표 파일명 보고 LLM이 1콜로 이름 생성.
  async function nameCommunities() {
    if (!graph || naming || !(graph.communities?.length)) return;
    setNaming(true);
    try {
      const members = new Map<number, string[]>();
      for (const n of graph.nodes) if (n.community != null) (members.get(n.community) ?? members.set(n.community, []).get(n.community)!).push(n.label);
      const lines = graph.communities.map((c) => `${c.id}: ${(members.get(c.id) ?? []).slice(0, 14).join(", ")}`).join("\n");
      const ask = `아래는 코드베이스를 실제 의존 연결 기준으로 자동 분할한 커뮤니티들이다. 각 커뮤니티의 대표 파일명들을 보고, 그 커뮤니티가 무슨 기능·역할인지 2~5단어로 짧게 이름 붙여라(예: "아웃리치 자동화", "인증 & 세션", "SRS 스케줄러"). 형식은 한 줄에 "id: 이름"만. 그 외 설명·머리말 금지.\n\n${lines}`;
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: "", locale, providerId, mode: "chat", messages: [{ role: "user", content: ask }], providerSettings } }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: { type: string; response?: { summary: string } };
          try { ev = JSON.parse(l); } catch { continue; }
          if (ev.type === "result" && ev.response) answer = ev.response.summary;
        }
      }
      const map: Record<number, string> = {};
      for (const line of answer.split("\n")) {
        const m = /^\s*(\d+)\s*[:.\-]\s*(.+?)\s*$/.exec(line);
        if (m) map[Number(m[1])] = m[2].replace(/^["'*`]+|["'*`]+$/g, "").trim();
      }
      if (Object.keys(map).length) setCommunityNames(map);
    } catch { /* 무시 */ } finally {
      setNaming(false);
    }
  }

  // 영향도 맵 — 켜짐 + 노드 선택 시에만. id→거리(0=자기,1=직접,2+=전이). 그래프뷰 색·배지 공용.
  const blastMap = useMemo(
    () => (blastMode && graph && selectedId ? blastRadius(graph, selectedId) : null),
    [blastMode, graph, selectedId],
  );
  const impactCount = blastMap ? blastMap.size - 1 : 0; // 자기 자신 제외

  // "한눈에" 리포트 — 그래프 통계만으로 계산(그래프 바뀔 때만).
  const overview = useMemo(() => (graph ? repoOverview(graph) : null), [graph]);

  return (
    <div aria-hidden={!active} className="flex h-full w-full min-h-0 flex-col">
      {showGraph && graph ? (
        // ── 그래프 모드 — 상단바 + 그래프 전면 ──
        <>
          <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <IconSitemap size={16} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
            <span className="truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100" title={path ?? ""}>{folderName}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">
              {t("repo.result").replace("{files}", String(graph.stats.files)).replace("{edges}", String(graph.stats.edges))}
              {graph.stats.capped ? ` ${t("repo.capped")}` : ""}
            </span>
            {blastMap && (
              <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                {t("repo.blastImpact").replace("{n}", String(impactCount))}
              </span>
            )}
            {graph.nodes.length > LARGE_GRAPH_NODES && (
              <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[12px] font-medium text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" title={t("repo.largeGraphHint")}>
                {t("repo.largeGraph")}
              </span>
            )}
            {reparsedNote != null && (
              <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                {t("repo.reparsed").replace("{n}", String(reparsedNote))}
              </span>
            )}
            {/* 배치 모드 세그먼트 — grid(관계)·layers(흐름)·treemap(덩치) 전환. */}
            <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
              {LAYOUT_META.map(({ mode, Icon, labelKey, enabled }) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && setLayoutMode(mode)}
                  title={enabled ? t(labelKey) : `${t(labelKey)} · ${t("repo.layoutSoon")}`}
                  aria-label={t(labelKey)}
                  aria-pressed={layoutMode === mode}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium transition ${
                    layoutMode === mode
                      ? "bg-[#3B34E2] text-white dark:bg-[#8b86f5] dark:text-zinc-900"
                      : enabled
                        ? "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        : "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
                  }`}
                >
                  <Icon size={14} stroke={2} aria-hidden />
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowOverview((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition ${
                showOverview
                  ? "border-[#3B34E2] bg-[#3B34E2] text-white dark:border-[#8b86f5] dark:bg-[#8b86f5] dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-[#3B34E2] hover:text-[#3B34E2] dark:border-zinc-700 dark:text-zinc-300"
              }`}
              aria-pressed={showOverview}
            >
              <IconEye size={14} stroke={2} aria-hidden />
              {t("repo.overview")}
            </button>
            <button
              type="button"
              onClick={() => setBlastMode((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition ${
                blastMode
                  ? "border-rose-500 bg-rose-500 text-white dark:border-rose-500 dark:bg-rose-500"
                  : "border-zinc-200 text-zinc-600 hover:border-rose-400 hover:text-rose-500 dark:border-zinc-700 dark:text-zinc-300"
              }`}
              aria-pressed={blastMode}
            >
              <IconRadar size={14} stroke={2} aria-hidden />
              {t("repo.blast")}
            </button>
            <button
              type="button"
              onClick={handleExportDot}
              title={t("repo.exportGraph")}
              aria-label={t("repo.exportGraph")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-[#8b86f5] dark:hover:text-[#8b86f5]"
            >
              <IconShare3 size={14} stroke={2} aria-hidden />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={analyzing}
              title={t("repo.refresh")}
              aria-label={t("repo.refresh")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-[#8b86f5] dark:hover:text-[#8b86f5]"
            >
              <IconRefresh size={14} stroke={2} className={analyzing ? "animate-spin" : ""} aria-hidden />
            </button>
            <button
              type="button"
              onClick={handlePick}
              disabled={picking || analyzing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-[#8b86f5] dark:hover:text-[#8b86f5]"
            >
              <IconFolderOpen size={14} stroke={2} aria-hidden />
              {t("repo.pickAnother")}
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            <div className="relative isolate min-h-0 min-w-0 flex-1">
              {/* 포커스 암전 — 캔버스 뒤(-z-10) 검정 백드롭(페이드). 관련 노드·칩은 위에 떠 선명. */}
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-0 -z-10 bg-black transition-opacity duration-500 ${selectedId && !showOverview ? "opacity-100" : "opacity-0"}`}
              />
              {/* 커뮤니티 리스트 — 색·라벨·개수, 클릭 토글로 숨김/표시(그래프 색과 매칭). */}
              {communityList.length > 1 && (
                <div className="nunopi-scroll absolute left-2 top-2 z-20 flex max-h-[70%] w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border border-zinc-200 bg-white/85 p-1.5 backdrop-blur dark:border-zinc-800 dark:bg-[#111219]/85">
                  <div className="flex items-center gap-1 px-1.5 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("repo.communities")}</span>
                    <button
                      type="button"
                      onClick={nameCommunities}
                      disabled={naming}
                      title={t("repo.communityName")}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[#3B34E2] transition hover:bg-zinc-100 disabled:opacity-50 dark:text-[#8b86f5] dark:hover:bg-zinc-800"
                    >
                      {naming ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={11} stroke={2} aria-hidden />}
                      {naming ? t("repo.communityNaming") : t("repo.communityName")}
                    </button>
                  </div>
                  {communityList.map(({ id, label, count, color }) => {
                    const off = hiddenCommunities.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleCommunity(id)}
                        className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${off ? "opacity-40" : ""}`}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                        <span className="truncate text-zinc-700 dark:text-zinc-200">{communityNames[id] ?? label}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {showOverview && overview && (
                <RepoOverviewPanel
                  overview={overview}
                  graph={graph}
                  providerId={providerId}
                  providerSettings={providerSettings}
                  summary={overviewSummary ?? undefined}
                  onSummarized={setOverviewSummary}
                  onSelect={setSelectedId}
                  onClose={() => setShowOverview(false)}
                />
              )}
              <RepoGraphView graph={graph} onNodeClick={setSelectedId} hiddenGroups={hiddenGroups} hiddenCommunities={hiddenCommunities} focusId={selectedId} blastMap={blastMap} mode={layoutMode} />
            </div>
            {selectedId && (
              <RepoNodePanel
                key={selectedId}
                graph={graph}
                nodeId={selectedId}
                providerId={providerId}
                providerSettings={providerSettings}
                explanation={explains[selectedId]}
                onExplained={(text) => setExplains((p) => ({ ...p, [selectedId]: text }))}
                chat={chats[selectedId]}
                onChat={(msgs) => setChats((p) => ({ ...p, [selectedId]: msgs }))}
                onClose={() => setSelectedId(null)}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </>
      ) : (
        // ── 시작/로딩/에러/웹 — 중앙 카드 ──
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:text-[#8b86f5]">
              <IconSitemap size={28} stroke={2} aria-hidden />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">{t("repo.title")}</h2>
              <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("repo.intro")}</p>
            </div>

            {!mounted ? null : desktop ? (
              <>
                <button
                  type="button"
                  onClick={handlePick}
                  disabled={picking || analyzing}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#3B34E2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]"
                >
                  <IconFolderOpen size={16} stroke={2} aria-hidden />
                  {path ? t("repo.pickAnother") : t("repo.pickFolder")}
                </button>
                {path && (
                  <div className="flex max-w-full flex-col items-center gap-1">
                    <span className="max-w-xs truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={path}>{path}</span>
                    {analyzing && (
                      <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
                        <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden />
                        {t("repo.analyzing")}
                      </span>
                    )}
                    {error && !analyzing && (
                      <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-rose-500">
                        <IconAlertTriangle size={14} stroke={2} aria-hidden />
                        {t("repo.error")}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12px] text-zinc-400 dark:text-zinc-500">{t("repo.desktopOnly")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
