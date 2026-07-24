import type { RepoGraph } from "./types";

// 그래프 배치 모드 — 관계(grid)·흐름(layers)·구성(treemap).
export type LayoutMode = "grid" | "layers" | "treemap";
export const LAYOUT_MODES: LayoutMode[] = ["grid", "layers", "treemap"];

export interface Pos { x: number; y: number }

// 노드 간격(그래프 좌표계 px) — 라벨 칩이 가로로 기니 가로 넉넉, 세로는 칩 높이만큼.
export const COL_GAP = 150;
export const ROW_GAP = 34;

// 결정적 배치 — 같은 그래프+모드 → 같은 좌표(새로고침·재렌더에도 위치 유지).
// 자식1: grid만 구현. layers/treemap(자식3·4)은 우선 grid로 폴백.
export function computeLayout(graph: RepoGraph, mode: LayoutMode): Map<string, Pos> {
  switch (mode) {
    case "layers":  // 자식3
    case "treemap": // 자식4
    case "grid":
    default:
      return gridLayout(graph);
  }
}

// 경로 정렬 후 격자로 배치. 정렬이라 같은 폴더 파일이 인접(자식2서 폴더 구역화).
function gridLayout(graph: RepoGraph): Map<string, Pos> {
  const ids = graph.nodes.map((n) => n.id).sort();
  // 화면비 보정 — 칸이 가로로 넓으니 열 수를 줄여 전체가 대략 정사각(fit 시 더 크게 보임).
  const cols = Math.max(1, Math.round(Math.sqrt((ids.length * ROW_GAP) / COL_GAP)));
  const pos = new Map<string, Pos>();
  ids.forEach((id, i) => {
    pos.set(id, { x: (i % cols) * COL_GAP, y: Math.floor(i / cols) * ROW_GAP });
  });
  return pos;
}
