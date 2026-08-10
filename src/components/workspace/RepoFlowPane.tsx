"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconSitemap, IconX, IconLoader2, IconChevronDown, IconRefresh, IconCode, IconBook2 } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";
import Markdown from "@/components/learning/Markdown";
import { stripCardBlock } from "@/lib/cardSuggestion";

// 기능별 아키텍처 플로우(#743) — Manyfast 유저플로우식: 레이어=밴드(위→아래), 알약 노드, 노드→코드 점프.
// next(다음 노드)를 받아 SVG 곡선으로 연결해 흐름을 직관적으로.
type FlowNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
type FlowSection = { layer: string; nodes: FlowNode[] };
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };
// 지하철식 직각 배선: 소스 노드 왼쪽에서 나와 → 왼쪽 거터의 전용 레인(세로) → 타깃 왼쪽으로 들어감.
// 박스는 거터 오른쪽에만 있어 선이 박스를 뚫지 않음. 소스별 레인·색 분리로 스파게티 방지.
type Line = { key: string; sk: string; tk: string; color: string; laneX: number; xs: number; ys: number; xt: number; yt: number };

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const nk = (s: string) => s.trim().toLowerCase(); // 노드 이름 정규화 키(엣지 매칭용)
// 출처(source 노드)별 색 — 겹쳐도 어디서 나왔는지 구분되게. 다크 배경서 잘 보이는 톤.
const EDGE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#c084fc", "#f472b6", "#2dd4bf", "#fb923c", "#a3e635", "#38bdf8"];
// 거터는 좁은 패널서 박스 폭을 뺏지 않게 상한(MAX_GUTTER)까지만. 레인이 상한 넘으면 x 재사용(색으로 구분).
const MAX_GUTTER = 48, LANE_GAP = 5, LANE_MARGIN = 6, LANE_PAD = 10, CORNER = 5; // px
const MAX_LANES = Math.max(1, Math.floor((MAX_GUTTER - LANE_MARGIN - LANE_PAD) / LANE_GAP));

// next 있는 소스 노드들의 정규화 키를 등장 순으로 — 레인 인덱스·색 배정 기준(측정·거터폭 계산 공용).
function sourceKeys(sections: FlowSection[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of sections) for (const n of s.nodes) {
    if (!n.next?.length) continue;
    const k = nk(n.name);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

// 튜터가 내는 "레이어 | 이름 | 파일:라인 | 역할 | →다음노드" 라인을 섹션으로. JSON 안 옴(튜터 페르소나).
function parseFlow(text: string): FlowSection[] {
  const order: string[] = [];
  const byLayer = new Map<string, FlowNode[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!line.includes("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const layer = parts[0], name = parts[1];
    if (/^(레이어|layer)$/i.test(layer) || /^(표시이름|이름|name|노드)$/i.test(name)) continue; // 형식 예시 헤더 에코 제거
    let file: string | undefined, lineNo: number | undefined, role: string | undefined, next: string[] | undefined;
    // 3번째 칸부터 순서 무관하게: 화살표=다음노드, 파일처럼 생김=파일:라인, 나머지=역할.
    for (const p of parts.slice(2)) {
      if (!p) continue;
      const arrow = p.match(/^(?:→|->|=>|다음\s*[:：]?)\s*(.+)$/);
      if (arrow) { next = arrow[1].split(/\s*[,，/、]\s*/).map((x) => x.trim().replace(/^[→>\-\s]+/, "")).filter(Boolean); continue; }
      if (!file && /[/.]/.test(p) && !/\s/.test(p.replace(/:\d+$/, ""))) {
        const m = p.match(/^(.*?):(\d+)$/);
        file = (m ? m[1] : p).replace(/^\.?\//, ""); lineNo = m ? Number(m[2]) : undefined; continue;
      }
      if (!role) role = p;
    }
    if (!byLayer.has(layer)) { byLayer.set(layer, []); order.push(layer); }
    byLayer.get(layer)!.push({ name, file, line: lineNo, role, next });
  }
  return order.map((layer) => ({ layer, nodes: byLayer.get(layer)! }));
}

// 응답에서 설명(산문) 추출 — 노드 라인(| 포함)·섹션 마커([설명]/[흐름])만 빼고, 문단 구분(빈 줄)은 보존.
function parseOverview(text: string): string {
  const cut = text.search(/```|nunopi-cards/i); // 카드 블록/코드펜스 이후는 설명 아님 → 자름(누수 방지)
  if (cut >= 0) text = text.slice(0, cut);
  const isMarker = (l: string) => /^\s*[[#*>\-\d.)\s]*\s*(설명|흐름|아키텍처|explanation|flow|architecture|overview)\s*[\]:：]*\s*$/i.test(l);
  const kept = text.split("\n").filter((l) => !l.includes("|") && !isMarker(l.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(); // 과도한 빈 줄만 축소
}

export default function RepoFlowPane({ feature, root, providerId, providerSettings, onOpenFile, onClose }: {
  feature?: string | null;
  root?: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onOpenFile?: (file: string, line?: number) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [sections, setSections] = useState<FlowSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]); // 노드 간 연결선(측정된 좌표)
  const [overview, setOverview] = useState<string | null>(null); // 이 아키텍처 설명(초보용 산문)
  const [overviewOpen, setOverviewOpen] = useState(true);        // 설명 박스 펼침
  const reqRef = useRef(0); // 최신 요청만 반영(빠른 feature 전환 경합 방지)
  const flowRef = useRef<HTMLDivElement | null>(null); // 연결선 좌표 기준 컨테이너
  const nodeEls = useRef(new Map<string, HTMLElement>()); // 이름키 → 노드 DOM(엣지 끝점 측정)

  const flowKey = feature && root ? `nunopi:ws:${root}:flow:${encodeURIComponent(feature)}` : null; // 레포+기능별 flow 영속 키(#743)

  const load = useCallback(async (force = false) => {
    if (!feature || !root || !providerId || !providerSettings) return;
    const my = ++reqRef.current;
    nodeEls.current.clear(); setLines([]);
    // 강제(새로고침) 아니면 저장된 flow 먼저 — 에이전트 재호출 없이 즉시 복원. (구 캐시=배열, 신 캐시={sections,overview})
    if (!force && flowKey) {
      try {
        const raw = localStorage.getItem(flowKey);
        if (raw) {
          const j = JSON.parse(raw);
          const secs: FlowSection[] | undefined = Array.isArray(j) ? j : j?.sections;
          if (Array.isArray(secs) && secs.length) { setSections(secs); setOverview(Array.isArray(j) ? null : (j?.overview ?? null)); setLoading(false); setErr(null); return; }
        }
      } catch { /* 캐시 손상 → 재생성 */ }
    }
    setLoading(true); setErr(null); setSections(null); setOverview(null);
    try {
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = basename(root);
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}`;
      const prompt = `레포 "${name}"에서 "${feature}" 기능의 아키텍처를 정리해줘. 아래 두 부분을 순서대로:\n\n[설명]\n이 기능이 전체적으로 어떻게 동작하는지, 각 조각이 왜 있고 서로 어떻게 이어지는지, 데이터가 어디서 어디로 흐르는지를 개발 초보도 완전히 이해할 수 있게 친절하고 자세히. **2~4개의 짧은 문단**으로 나누고 문단 사이엔 빈 줄을 넣어. 파일/함수 이름은 백틱(\`)으로 감싸. 이 부분엔 파이프(|) 기호를 쓰지 말 것.\n\n[흐름]\n그 다음 각 노드를 한 줄씩, 아래 형식으로만:\n레이어 | 표시이름 | 파일경로:라인 | 한줄역할 | → 다음노드이름\n(진입(UI/route)→처리(IPC/handler)→서비스/로직→데이터/외부 순. 파일경로는 위 목록의 실제 경로. 라인 모르면 파일만. "→ 다음노드"는 흐름상 이어지는 노드 표시이름들(쉼표로 여러 개), 없으면 생략. 표시이름은 서로 정확히 일치시켜 연결되게. 예: 진입·UI | AnalyzeControls | src/components/AnalyzeControls.tsx | 분석 버튼 | → analyze route)`;
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
      });
      if (!res.ok || !res.body) { if (my === reqRef.current) setErr(`HTTP ${res.status}`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; }
      }
      if (my !== reqRef.current) return; // 더 최신 요청이 진행 중 → 폐기
      if (streamErr) { setErr(streamErr); return; }
      const clean = stripCardBlock(answer); // 튜터가 자동으로 붙이는 nunopi-cards 블록 제거
      const parsed = parseFlow(clean);
      if (!parsed.length) { setErr(`no flow — ${clean.slice(0, 140)}`); return; }
      const ov = parseOverview(clean) || null;
      setSections(parsed); setOverview(ov);
      if (flowKey) { try { localStorage.setItem(flowKey, JSON.stringify({ sections: parsed, overview: ov })); } catch { /* ignore */ } } // 영속(#743)
    } catch (e) {
      if (my === reqRef.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, [feature, root, providerId, providerSettings, locale, flowKey]);

  // 연결선 좌표 측정 — 각 노드 DOM 위치를 컨테이너 기준 상대좌표로. wrap/리사이즈 후 다시.
  const measure = useCallback(() => {
    const cont = flowRef.current;
    if (!cont || !sections) { setLines([]); return; }
    const cr = cont.getBoundingClientRect();
    const keys = sourceKeys(sections);
    // 1) 유효 엣지 수집(양끝 DOM 존재하는 것만).
    const raw: { srcName: string; srcKey: string; tgt: string; tgtKey: string; a: HTMLElement; b: HTMLElement }[] = [];
    for (const s of sections) for (const n of s.nodes) {
      if (!n.next?.length) continue;
      const a = nodeEls.current.get(nk(n.name));
      if (!a) continue;
      for (const target of n.next) {
        const b = nodeEls.current.get(nk(target));
        if (!b || b === a) continue;
        raw.push({ srcName: n.name, srcKey: nk(n.name), tgt: target, tgtKey: nk(target), a, b });
      }
    }
    // 2) 타깃별 incoming 개수 — 진입 y를 박스 높이에 분산(겹침 방지). 나감은 위쪽 한 점(버스)으로 모음.
    const inCount = new Map<string, number>();
    for (const r of raw) inCount.set(r.tgtKey, (inCount.get(r.tgtKey) ?? 0) + 1);
    const inIdx = new Map<string, number>();
    const out: Line[] = [];
    for (const r of raw) {
      const li = keys.indexOf(r.srcKey);
      const color = EDGE_COLORS[li % EDGE_COLORS.length];
      const laneX = LANE_MARGIN + (li % MAX_LANES) * LANE_GAP;
      const ar = r.a.getBoundingClientRect(), br = r.b.getBoundingClientRect();
      const xs = ar.left - cr.left, ys = ar.top - cr.top + ar.height * 0.24; // 나감: 위쪽(진입 밴드와 분리)
      const n = inCount.get(r.tgtKey)!;
      const k = inIdx.get(r.tgtKey) ?? 0; inIdx.set(r.tgtKey, k + 1);
      const frac = n === 1 ? 0.6 : 0.46 + ((k + 0.5) / n) * 0.44; // 들어옴: 0.46~0.90 균등 분산
      out.push({ key: `${r.srcName}->${r.tgt}#${k}`, sk: r.srcKey, tk: r.tgtKey, color, laneX, xs, ys, xt: br.left - cr.left, yt: br.top - cr.top + br.height * frac });
    }
    setLines(out);
  }, [sections]);

  // feature 바뀌면 자동 로드.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 로드(내부 setState는 이펙트 동기 실행 아님)
  useEffect(() => { void load(); }, [load]);

  // 렌더 후 연결선 측정 + 컨테이너 리사이즈(wrap 변화) 시 재측정.
  useLayoutEffect(() => {
    measure();
    const cont = flowRef.current;
    if (!cont || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(cont);
    return () => ro.disconnect();
  }, [measure]);

  const [hovered, setHovered] = useState<string | null>(null); // 호버 카드 키(연결 강조)
  const [focused, setFocused] = useState<string | null>(null); // 클릭 포커스 카드 키(무관 어둡게)
  const anyEdge = !!sections?.some((s) => s.nodes.some((n) => n.next?.length)); // 엣지 있으면 선으로, 없으면 꺾쇠 폴백

  // 노드별 인접집합(자기 + next 타깃 + 자기를 가리키는 소스). 양방향 대칭, 자기 포함.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => { let s = m.get(a); if (!s) { s = new Set([a]); m.set(a, s); } s.add(b); };
    if (sections) for (const sec of sections) for (const n of sec.nodes) {
      const sk = nk(n.name); add(sk, sk);
      for (const tgt of n.next ?? []) { const tk = nk(tgt); add(sk, tk); add(tk, sk); }
    }
    return m;
  }, [sections]);
  const relatedOf = useCallback((key: string | null) => (key ? adjacency.get(key) ?? new Set([key]) : null), [adjacency]);

  // 포커스(클릭)는 밖·다른카드 누르기 전까지 계속 유지, 호버는 그 위에 추가 강조 — 두 집합 합집합.
  const hoverSet = relatedOf(hovered);
  const focusSet = relatedOf(focused);
  const inFocus = (k: string) => !!focused && !!focusSet?.has(k);
  const inHover = (k: string) => !!hovered && !!hoverSet?.has(k);
  const gutter = sections && anyEdge // 왼쪽 배선 레인 폭 — 상한 캡(좁은 패널 보호)
    ? Math.min(MAX_GUTTER, LANE_MARGIN + Math.min(sourceKeys(sections).length, MAX_LANES) * LANE_GAP + LANE_PAD)
    : 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconSitemap size={14} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{feature || t("flow.title")}</span>
        {feature && (
          <button type="button" onClick={() => void load(true)} disabled={loading} title={t("usage.refresh")} aria-label={t("usage.refresh")}
            className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconRefresh size={13} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")}
            className={`${feature ? "" : "ml-auto "}shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}>
            <IconX size={14} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-auto p-4">
        {!feature ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-zinc-400 dark:text-zinc-500">{t("flow.pickFeature")}</div>
        ) : loading && !sections ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /> {t("flow.loading")}</div>
        ) : err ? (
          <div className="flex flex-col gap-1"><p className="text-[12px] text-rose-500">{t("flow.error")}</p><p className="break-words text-[10px] text-zinc-400 dark:text-zinc-500">{err}</p></div>
        ) : sections ? (
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-3">
            {/* 이 아키텍처 설명(초보용) — 흐름 위 접이식 박스(#743). */}
            {overview && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/40">
                <button type="button" onClick={() => setOverviewOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
                  <IconBook2 size={13} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
                  <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("flow.overview")}</span>
                  <IconChevronDown size={14} stroke={2} className={`ml-auto shrink-0 text-zinc-400 transition ${overviewOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
                {overviewOpen && <div className="border-t border-zinc-200/70 px-3.5 py-3 text-[12.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"><Markdown>{overview}</Markdown></div>}
              </div>
            )}
            {/* 세로 단일컬럼 흐름 — 왼쪽 거터에 소스별 레인, 지하철식 직각 배선으로 박스를 안 뚫고 연결. 빈 곳 클릭 → 포커스 해제. */}
            <div ref={flowRef} onClick={() => setFocused(null)} style={{ paddingLeft: gutter }} className="relative flex w-full flex-col gap-2">
            {/* 배선 오버레이 — 노드보다 뒤에 깔림, 클릭은 통과. 화살촉은 타깃 왼쪽으로 진입. */}
            <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible" aria-hidden>
              <defs>
                {/* context-stroke: 화살촉이 각 선 색을 그대로 상속(선마다 색 달라도 한 marker로) */}
                <marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke" />
                </marker>
              </defs>
              {lines.map((l) => {
                const sgn = l.yt >= l.ys ? 1 : -1;                          // 세로 진행 방향
                const r = Math.min(CORNER, Math.abs(l.yt - l.ys) / 2 || 0); // 짧은 세로구간에선 모서리 축소
                // 소스 왼쪽 → 레인까지 수평 → 레인 세로 → 타깃 왼쪽 수평(화살촉). 모서리 2곳 라운드.
                const d = `M ${l.xs} ${l.ys} L ${l.laneX + r} ${l.ys} Q ${l.laneX} ${l.ys} ${l.laneX} ${l.ys + sgn * r} L ${l.laneX} ${l.yt - sgn * r} Q ${l.laneX} ${l.yt} ${l.laneX + r} ${l.yt} L ${l.xt} ${l.yt}`;
                const incidentFocus = !!focused && (l.sk === focused || l.tk === focused);
                const incidentHover = !!hovered && (l.sk === hovered || l.tk === hovered);
                const hot = incidentFocus || incidentHover;                 // 포커스/호버 노드에 붙은 선 → 굵게
                const dim = !!focused && !incidentFocus && !incidentHover;   // 포커스 시 무관선 흐리게(호버선은 살림)
                return <path key={l.key} d={d} fill="none" stroke={l.color} strokeWidth={hot ? 3 : 1.75}
                  opacity={dim ? 0.1 : hot ? 1 : 0.9} markerEnd="url(#flow-arrow)" className="transition-[stroke-width,opacity] duration-150" />;
              })}
            </svg>
            {sections.map((s, i) => (
              <div key={s.layer + i} className="relative flex flex-col gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/30">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{s.layer}</div>
                {s.nodes.map((n, j) => {
                  const key = nk(n.name);
                  const lifted = inFocus(key) || inHover(key);           // 포커스 연결 대상(유지) + 호버 연결 대상 → 빛남
                  const dimmed = !!focused && !inFocus(key) && !inHover(key); // 포커스 시 무관 카드 어둡게(호버 대상은 살림)
                  const toggleFocus = () => setFocused((prev) => (prev === key ? null : key));
                  return (
                  // 카드 본문 클릭 = 포커스만(코드 자동 X). 코드/diff 패널은 우상단 아이콘으로만 연다(#743).
                  <div key={j} role="button" tabIndex={0}
                    ref={(el) => { if (el) nodeEls.current.set(key, el); }}
                    onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}
                    onClick={(e) => { e.stopPropagation(); toggleFocus(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocus(); } }}
                    style={{ opacity: dimmed ? 0.3 : 1 }}
                    className={`group relative flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 pr-7 text-left transition duration-150 ${lifted ? "z-20 scale-[1.03] border-[#3B34E2] shadow-[0_0_16px_0_rgba(59,52,226,0.55)] dark:border-[#8b86f5] dark:shadow-[0_0_18px_0_rgba(139,134,245,0.55)]" : "z-10 border-zinc-200 hover:border-[#3B34E2] dark:border-zinc-700 dark:hover:border-[#8b86f5]"} bg-white dark:bg-zinc-800/60`}>
                    {n.file && (
                      <button type="button" title={t("flow.openCode")} aria-label={t("flow.openCode")}
                        onClick={(e) => { e.stopPropagation(); onOpenFile?.(n.file!, n.line); }}
                        className="absolute right-1 top-1 rounded p-1 text-zinc-300 opacity-0 transition hover:bg-zinc-100 hover:text-[#3B34E2] group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-[#8b86f5]">
                        <IconCode size={13} stroke={2} aria-hidden />
                      </button>
                    )}
                    <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{n.name}</span>
                    {n.file && <span className="break-all font-mono text-[9px] text-[#3B34E2] dark:text-[#8b86f5]">{n.file}{n.line ? `:${n.line}` : ""}</span>}
                    {n.role && <span className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{n.role}</span>}
                  </div>
                  );
                })}
                {!anyEdge && i < sections.length - 1 && (
                  <div className="flex justify-center text-zinc-300 dark:text-zinc-600"><IconChevronDown size={16} stroke={2} aria-hidden /></div>
                )}
              </div>
            ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
