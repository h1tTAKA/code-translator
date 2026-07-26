"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { groupColors, communityColor, hexToRgba, REPO_NODE_FALLBACK } from "@/lib/repo/colors";
import { computeLayout, focusLayout, folderRegionLayout, communityRegionLayout, treemapLayout, ROW_GAP, type LayoutMode, type Pos, type Region } from "@/lib/repo/layout";
import type { RepoGraph } from "@/lib/repo/types";

// react-force-graph-2d는 canvas·window를 쓰는 브라우저 전용 → SSR 끔(서버서 안 그림).
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// 런타임에 force-graph가 x/y를 채움. fx/fy=고정 좌표(물리 끔).
type GNode = { id: string; name: string; group?: string; community?: number; x?: number; y?: number; fx?: number; fy?: number };
type GLink = { source: GNode | string; target: GNode | string };

const groupOf = (n: GNode) => n.group ?? "(root)";
const linkEnd = (e: GNode | string) => (typeof e === "object" ? e.id : e); // 링크 끝(노드객체 또는 id)
const DIM = "rgba(120,120,130,0.30)"; // focus/blast 밖 흐림
const short = (s: string) => (s.length > 22 ? s.slice(0, 21) + "…" : s); // 라벨 길이 캡

// 블래스트 색 — 직접 의존자(거리1)=빨강, 전이(거리2+)=주황.
const BLAST_DIRECT = "#ef4444";
const BLAST_TRANSITIVE = "#f59e0b";
const LABEL_FONT = 7;   // 라벨 글자 크기(그래프 좌표 고정 — 줌에 비례, 격자 간격 안에서 안 겹침)
const LABEL_H = LABEL_FONT + 4; // 칩 높이(그래프 좌표)

// 이 노드 수 넘으면 "대형" — 매 프레임 비용 절감(RepoView 배지도 공유).
export const LARGE_GRAPH_NODES = 600;

// 레포 그래프 — 파일 노드 + import 엣지. 고정 좌표(computeLayout)로 배치, 물리 끔(안 흩어짐).
// 색=폴더. hiddenGroups=필터, focusId=선택 강조, blastMap=영향도, mode=배치 방식.
export default function RepoGraphView({ graph, onNodeClick, hiddenGroups, pickedCommunities, focusId, blastMap, mode = "grid" }: {
  graph: RepoGraph;
  onNodeClick?: (id: string) => void;
  hiddenGroups?: Set<string>;
  // 강조 선택 커뮤니티 — 비어있으면 전체 정상, 있으면 선택된 것만 밝고 나머진 dim.
  pickedCommunities?: Set<number>;
  focusId?: string | null;
  blastMap?: Map<string, number> | null;
  mode?: LayoutMode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // react-force-graph 인스턴스(zoomToFit 등). dynamic import라 타입 정밀화 어려워 any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null); // 호버 칩 강조(클릭 가능 신호)
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data, colorOf, basePos, regions } = useMemo(() => {
    const groups = Array.from(new Set(graph.nodes.map((n) => n.group ?? "(root)")));
    const gc = groupColors(groups);
    const colorOf = (g?: string) => gc.get(g ?? "(root)") ?? REPO_NODE_FALLBACK;
    // grid/treemap=좌표+구역 사각형 함께. treemap은 캔버스 크기 넘겨 면적 타일링(size 0이면 기본). 그 외는 좌표만.
    const layout = mode === "grid"
      ? folderRegionLayout(graph)
      : mode === "community"
        ? communityRegionLayout(graph)
        : mode === "treemap"
          ? treemapLayout(graph, size.w || 1600, size.h || 900)
          : { pos: computeLayout(graph, mode), regions: [] as Region[] };
    const pos = layout.pos; // 결정적 기본 좌표
    return {
      colorOf,
      basePos: pos,
      regions: layout.regions,
      data: {
        nodes: graph.nodes.map((n) => {
          const p = pos.get(n.id) ?? { x: 0, y: 0 };
          return { id: n.id, name: n.label, group: n.group, community: n.community, x: p.x, y: p.y, fx: p.x, fy: p.y }; // fx/fy=고정
        }),
        links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
    };
  }, [graph, mode, size]); // size: treemap 리사이즈 재타일

  // focus 대상 = 선택 노드 + 직접 이웃. 없으면 null(전체 진하게).
  const related = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const e of graph.edges) {
      if (e.source === focusId) set.add(e.target);
      else if (e.target === focusId) set.add(e.source);
    }
    return set;
  }, [focusId, graph]);

  const nodeComm = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.community])), [graph]);
  const visible = (n: GNode) => !hiddenGroups?.has(groupOf(n));
  // 커뮤니티 강조 활성 여부 + 노드가 선택군에 속하는지.
  const picking = (pickedCommunities?.size ?? 0) > 0;
  const inPicked = (c?: number) => c != null && !!pickedCommunities?.has(c);
  const commOf = (id: string) => nodeComm.get(id);

  // 노드 자기 색 — 커뮤니티 있으면 커뮤니티색, 없으면 폴더색.
  const ownColor = (gn: GNode): string => (gn.community != null ? communityColor(gn.community) : colorOf(gn.group));
  // 노드 색 — 영향도 > focus > 자기색(커뮤니티/폴더) 순.
  const nodeFill = (gn: GNode): string => {
    if (blastMap) {
      const d = blastMap.get(gn.id);
      if (d === undefined) return DIM;
      if (d === 0) return ownColor(gn);
      return d === 1 ? BLAST_DIRECT : BLAST_TRANSITIVE;
    }
    if (related && !related.has(gn.id)) return DIM;
    if (picking && !inPicked(gn.community)) return DIM; // 강조 모드: 비선택 커뮤니티 흐리게
    return ownColor(gn);
  };

  const isLarge = graph.nodes.length > LARGE_GRAPH_NODES;

  // 포커스 화면맞춤 — 관련이 선택 노드 1개뿐(고립 파일)이면 zoomToFit이 점 하나에 무한 확대됨(칩이 화면 덮음).
  // 그 경우 고정 줌으로 노드 중앙 정렬만. 여럿이면 기존대로 관련·보이는 것만 맞춤.
  const fitFocus = (ms: number) => {
    const fg = fgRef.current;
    if (!fg || !related) return;
    const visN = graph.nodes.filter((n) => related.has(n.id) && !hiddenGroups?.has(n.group ?? "(root)"));
    if (visN.length <= 1) { fg.centerAt?.(0, 0, ms); fg.zoom?.(2.5, ms); } // 포커스 노드는 focusLayout서 (0,0)
    else fg.zoomToFit?.(ms, 60, (n: GNode) => related.has(n.id) && visible(n));
  };

  // 포커스 시 관련 노드를 focusLayout 좌표로, 해제 시 기본 좌표로 실좌표(fx/fy=x/y) 트윈 이동.
  // 실좌표를 옮기므로 그리기·클릭영역이 같은 n.x 공유 → desync 없음. setState 없음.
  const rafRef = useRef<number | null>(null);
  const prevFocus = useRef<string | null>(null);
  useEffect(() => {
    const nodes = data.nodes as GNode[];
    // focusId 실제 변화에만 트윈 — data-only 변화(모드 전환·리사이즈 재타일)로는 재시작 안 함(트윈 글리치 방지).
    const prev = prevFocus.current;
    const curr = focusId ?? null;
    prevFocus.current = curr;
    if (prev === curr) return;
    if (!nodes.length) return;

    const fpos = focusId ? focusLayout(graph, focusId) : null;
    const target = (id: string, cur: Pos): Pos => (fpos?.get(id)) ?? basePos.get(id) ?? cur; // 비관련=기본 좌표
    const starts = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    const t0 = performance.now();
    const DUR = 460;
    const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2); // easeInOutQuad
    // 엔진 재가열 — cooldownTicks 동안 렌더 루프가 돌아 매 프레임 mutated 좌표를 그려줌
    // (force-graph엔 단발 redraw API가 없음. fx/fy 고정이라 물리 이동은 없고 우리 트윈만 보임).
    fgRef.current?.d3ReheatSimulation?.();

    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / DUR);
      const e = ease(k);
      for (const n of nodes) {
        const s = starts.get(n.id); if (!s) continue;
        const tg = target(n.id, s);
        n.x = n.fx = s.x + (tg.x - s.x) * e;
        n.y = n.fy = s.y + (tg.y - s.y) * e;
      }
      if (k < 1) { rafRef.current = requestAnimationFrame(tick); }
      else {
        rafRef.current = null;
        // 프레이밍: 포커스면 관련(보이는)만, 아니면 전체.
        if (focusId && related) fitFocus(500);
        else fgRef.current?.zoomToFit?.(500, 70);
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusId/data 변화에만 트윈(related/basePos/graph는 그로부터 파생)
  }, [focusId, data]);

  return (
    <div ref={wrapRef} className="h-full w-full">
      {size.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          nodeVisibility={(n) => {
            const gn = n as GNode;
            if (!visible(gn)) return false;
            if (focusId && related && !related.has(gn.id)) return false; // 포커스: 비관련 숨김
            return true;
          }}
          // 폴더 구역 박스+라벨 — 노드 아래 레이어(onRenderFramePre). grid·비포커스일 때만.
          // 미리 계산한 regions 사용(매 프레임 좌표 스캔 X). 숨긴 폴더는 박스도 숨김.
          onRenderFramePre={(ctx, globalScale) => {
            if ((mode !== "grid" && mode !== "treemap" && mode !== "community") || focusId || !regions.length) return; // grid·treemap·community 박스
            const labelFont = ROW_GAP * 0.7; // 상단 라벨 밴드(ROW_GAP*2) 안에 들어가는 폴더명 크기
            for (const r of regions) {
              if (r.community == null && hiddenGroups?.has(r.group)) continue; // 폴더 필터로 숨긴 구역 → 박스도 숨김(커뮤니티 구역은 폴더 필터 무관)
              const c = r.community != null ? communityColor(r.community) : colorOf(r.group);
              ctx.fillStyle = hexToRgba(c, 0.05);   // 아주 옅은 채움(노드·라벨 안 가림)
              ctx.fillRect(r.x, r.y, r.w, r.h);
              ctx.lineWidth = 1 / globalScale;      // 줌 무관 헤어라인 경계
              ctx.strokeStyle = hexToRgba(c, 0.22);
              ctx.strokeRect(r.x, r.y, r.w, r.h);
              ctx.font = `700 ${labelFont}px ui-sans-serif, system-ui, sans-serif`;
              ctx.textAlign = "left";
              ctx.textBaseline = "top";
              ctx.fillStyle = hexToRgba(c, 0.7);
              ctx.fillText(r.label, r.x + 8, r.y + 6);
            }
          }}
          // 노드 = 파일명 라벨 칩(항상, 테두리로 클릭 대상 명확). 동그란 점 없음.
          nodeCanvasObject={(node, ctx) => {
            const n = node as GNode;
            if (n.x == null || n.y == null) return;
            const fill = nodeFill(n);
            const dim = fill === DIM;
            const hovered = n.id === hoverId;
            const isFocus = n.id === focusId;                 // 선택 노드 = 특별 강조(★+액센트+글로우)
            // 트리맵 개요(비포커스) = 파일을 폴더색 사각타일로("덩치" 시각). 호버 시만 파일명.
            if (mode === "treemap" && !focusId) {
              const s = hovered ? 9 : 7; // 타일 반경(그래프 좌표) — 호버 시 커져 클릭 유도
              ctx.fillStyle = fill;
              ctx.globalAlpha = hovered ? 1 : 0.85;
              ctx.fillRect(n.x - s, n.y - s, s * 2, s * 2);
              ctx.globalAlpha = 1;
              if (hovered) { ctx.lineWidth = 1.5; ctx.strokeStyle = isDark ? "#fff" : "#18181b"; ctx.strokeRect(n.x - s, n.y - s, s * 2, s * 2); }
              if (hovered) {
                ctx.font = `600 ${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                const label = short(n.name), tw = ctx.measureText(label).width, w = tw + 8;
                ctx.fillStyle = isDark ? "rgba(24,24,27,0.95)" : "rgba(255,255,255,0.95)";
                ctx.fillRect(n.x - w / 2, n.y - s - LABEL_H - 1, w, LABEL_H);
                ctx.fillStyle = fill;
                ctx.fillText(label, n.x, n.y - s - LABEL_H / 2 - 1);
              }
              return;
            }
            const accent = isDark ? "#8b86f5" : "#3B34E2";
            const label = (isFocus ? "★ " : "") + short(n.name);
            ctx.font = `${isFocus ? 700 : 600} ${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const tw = ctx.measureText(label).width;
            const w = tw + (isFocus ? 18 : 14), x0 = n.x - w / 2, y0 = n.y - LABEL_H / 2;
            // 배경칩 + 테두리. 선택=액센트 칩+글로우, 호버=진하게+폴더색 테두리.
            if (isFocus) { ctx.shadowColor = accent; ctx.shadowBlur = 9; }
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") ctx.roundRect(x0, y0, w, LABEL_H, 2.5);
            else ctx.rect(x0, y0, w, LABEL_H); // 구형 캔버스 폴백
            ctx.fillStyle = isFocus
              ? accent
              : isDark
                ? (dim ? "rgba(24,24,27,0.4)" : hovered ? "rgba(39,39,46,0.96)" : "rgba(24,24,27,0.82)")
                : (dim ? "rgba(255,255,255,0.4)" : hovered ? "rgba(244,244,245,0.98)" : "rgba(255,255,255,0.88)");
            ctx.fill();
            ctx.shadowBlur = 0; // 글로우 리셋(텍스트·다음 노드로 안 번지게)
            if (isFocus) {
              ctx.lineWidth = 1;
              ctx.strokeStyle = accent;
              ctx.stroke();
            } else if (!dim) {
              ctx.lineWidth = hovered ? 1 : 0.5;
              ctx.strokeStyle = hovered ? fill : isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
              ctx.stroke();
            }
            ctx.fillStyle = isFocus ? (isDark ? "#18181b" : "#ffffff") : dim ? DIM : fill;
            ctx.fillText(label, n.x, n.y + 0.5);
          }}
          // 클릭 히트 영역 = 칩보다 넉넉히. 선택(★·700) 라벨과 폰트·너비 일치(과녁 어긋남 방지).
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GNode;
            if (n.x == null || n.y == null) return;
            const isFocus = n.id === focusId;
            if (mode === "treemap" && !focusId) { // 타일 개요=넉넉한 사각 과녁(작은 타일 클릭 쉽게)
              const hs = 12;
              ctx.fillStyle = color;
              ctx.fillRect(n.x - hs, n.y - hs, hs * 2, hs * 2);
              return;
            }
            const label = (isFocus ? "★ " : "") + short(n.name);
            ctx.font = `${isFocus ? 700 : 600} ${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
            const w = ctx.measureText(label).width + 24;
            const h = LABEL_H + 12;
            ctx.fillStyle = color;
            ctx.fillRect(n.x - w / 2, n.y - h / 2, w, h);
          }}
          nodeLabel={(n) => (n as GNode).id}
          nodeRelSize={4}
          linkVisibility={(l) => {
            const s = (l as GLink).source, t = (l as GLink).target;
            const sv = typeof s === "object" ? visible(s) : true;
            const tv = typeof t === "object" ? visible(t) : true;
            if (!sv || !tv) return false;
            if (mode === "treemap" && !focusId) return false; // 트리맵 개요=선 숨김(덩치 뷰), 포커스 시 복원
            if (focusId && related) { // 포커스: 양 끝 다 관련일 때만
              return related.has(linkEnd(s)) && related.has(linkEnd(t));
            }
            return true;
          }}
          linkColor={(l) => {
            const s = linkEnd((l as GLink).source), t = linkEnd((l as GLink).target);
            if (blastMap) {
              return blastMap.has(s) && blastMap.has(t) ? "rgba(239,68,68,0.45)" : "rgba(120,120,130,0.06)";
            }
            if (related) return related.has(s) && related.has(t) ? "rgba(139,134,245,0.55)" : "rgba(120,120,130,0.07)";
            if (picking) return inPicked(commOf(s)) && inPicked(commOf(t)) ? "rgba(139,134,245,0.5)" : "rgba(120,120,130,0.05)";
            return "rgba(120,120,130,0.20)";
          }}
          linkDirectionalArrowLength={isLarge ? 0 : 2}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n) => onNodeClick?.((n as GNode).id)}
          onNodeHover={(n) => {
            const el = wrapRef.current; if (el) el.style.cursor = n ? "pointer" : "default";
            setHoverId(n ? (n as GNode).id : null);
          }}
          cooldownTicks={60}                                 // 고정 좌표(안 흩어짐)지만 재가열 트윈 프레임 렌더용 짧게 유지
          onEngineStop={() => {                              // 엔진 정지 시 화면 맞춤(포커스면 관련 보이는 것만)
            if (focusId && related) fitFocus(500);
            else fgRef.current?.zoomToFit?.(400, 70);
          }}
        />
      )}
    </div>
  );
}
