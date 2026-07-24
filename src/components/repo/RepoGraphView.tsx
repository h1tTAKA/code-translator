"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { groupColors, REPO_NODE_FALLBACK } from "@/lib/repo/colors";
import { computeLayout, type LayoutMode } from "@/lib/repo/layout";
import type { RepoGraph } from "@/lib/repo/types";

// react-force-graph-2d는 canvas·window를 쓰는 브라우저 전용 → SSR 끔(서버서 안 그림).
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// 런타임에 force-graph가 x/y를 채움. fx/fy=고정 좌표(물리 끔).
type GNode = { id: string; name: string; group?: string; x?: number; y?: number; fx?: number; fy?: number };
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
export default function RepoGraphView({ graph, onNodeClick, hiddenGroups, focusId, blastMap, mode = "grid" }: {
  graph: RepoGraph;
  onNodeClick?: (id: string) => void;
  hiddenGroups?: Set<string>;
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

  const { data, colorOf } = useMemo(() => {
    const groups = Array.from(new Set(graph.nodes.map((n) => n.group ?? "(root)")));
    const gc = groupColors(groups);
    const colorOf = (g?: string) => gc.get(g ?? "(root)") ?? REPO_NODE_FALLBACK;
    const pos = computeLayout(graph, mode); // 결정적 좌표
    return {
      colorOf,
      data: {
        nodes: graph.nodes.map((n) => {
          const p = pos.get(n.id) ?? { x: 0, y: 0 };
          return { id: n.id, name: n.label, group: n.group, x: p.x, y: p.y, fx: p.x, fy: p.y }; // fx/fy=고정
        }),
        links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
    };
  }, [graph, mode]);

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

  const visible = (n: GNode) => !hiddenGroups?.has(groupOf(n));

  // 노드 색 — 영향도 > focus > 폴더색 순.
  const nodeFill = (gn: GNode): string => {
    if (blastMap) {
      const d = blastMap.get(gn.id);
      if (d === undefined) return DIM;
      if (d === 0) return colorOf(gn.group);
      return d === 1 ? BLAST_DIRECT : BLAST_TRANSITIVE;
    }
    if (related && !related.has(gn.id)) return DIM;
    return colorOf(gn.group);
  };

  const isLarge = graph.nodes.length > LARGE_GRAPH_NODES;

  return (
    <div ref={wrapRef} className="h-full w-full">
      {size.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          nodeVisibility={(n) => visible(n as GNode)}
          // 노드 = 파일명 라벨 칩(항상, 테두리로 클릭 대상 명확). 동그란 점 없음.
          nodeCanvasObject={(node, ctx) => {
            const n = node as GNode;
            if (n.x == null || n.y == null) return;
            const fill = nodeFill(n);
            const dim = fill === DIM;
            const hovered = n.id === hoverId;
            const label = short(n.name);
            ctx.font = `600 ${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const tw = ctx.measureText(label).width;
            const w = tw + 14, x0 = n.x - w / 2, y0 = n.y - LABEL_H / 2;
            // 배경칩 + 테두리 — 버튼처럼 보이게. 호버 시 진하게+폴더색 테두리.
            ctx.beginPath();
            ctx.roundRect(x0, y0, w, LABEL_H, 2.5);
            ctx.fillStyle = isDark
              ? (dim ? "rgba(24,24,27,0.4)" : hovered ? "rgba(39,39,46,0.96)" : "rgba(24,24,27,0.82)")
              : (dim ? "rgba(255,255,255,0.4)" : hovered ? "rgba(244,244,245,0.98)" : "rgba(255,255,255,0.88)");
            ctx.fill();
            if (!dim) {
              ctx.lineWidth = hovered ? 1 : 0.5;
              ctx.strokeStyle = hovered ? fill : isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
              ctx.stroke();
            }
            ctx.fillStyle = dim ? DIM : fill;
            ctx.fillText(label, n.x, n.y + 0.5);
          }}
          // 클릭 히트 영역 = 칩보다 넉넉히(패딩) — 글자만이라 작던 과녁 확대.
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GNode;
            if (n.x == null || n.y == null) return;
            ctx.font = `600 ${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
            const w = ctx.measureText(short(n.name)).width + 24;
            const h = LABEL_H + 12;
            ctx.fillStyle = color;
            ctx.fillRect(n.x - w / 2, n.y - h / 2, w, h);
          }}
          nodeLabel={(n) => (n as GNode).id}
          nodeRelSize={4}
          linkVisibility={(l) => {
            const s = (l as GLink).source, t = (l as GLink).target;
            return (typeof s === "object" ? visible(s) : true) && (typeof t === "object" ? visible(t) : true);
          }}
          linkColor={(l) => {
            const s = linkEnd((l as GLink).source), t = linkEnd((l as GLink).target);
            if (blastMap) {
              return blastMap.has(s) && blastMap.has(t) ? "rgba(239,68,68,0.45)" : "rgba(120,120,130,0.06)";
            }
            if (!related) return "rgba(120,120,130,0.20)";
            return related.has(s) && related.has(t) ? "rgba(139,134,245,0.55)" : "rgba(120,120,130,0.07)";
          }}
          linkDirectionalArrowLength={isLarge ? 0 : 2}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n) => onNodeClick?.((n as GNode).id)}
          onNodeHover={(n) => {
            const el = wrapRef.current; if (el) el.style.cursor = n ? "pointer" : "default";
            setHoverId(n ? (n as GNode).id : null);
          }}
          cooldownTicks={0}                                  // 고정 좌표라 시뮬 불필요(안 흩어짐)
          onEngineStop={() => fgRef.current?.zoomToFit(400, 40)} // 배치 후 화면 맞춤
        />
      )}
    </div>
  );
}
