import type { RepoGraph } from "./types";

// 그래프 배치 모드 — 관계(grid)·흐름(layers)·구성(treemap).
export type LayoutMode = "grid" | "layers" | "treemap";
export const LAYOUT_MODES: LayoutMode[] = ["grid", "layers", "treemap"];

export interface Pos { x: number; y: number }

// 노드 간격(그래프 좌표계 px) — 라벨 칩이 가로로 기니 가로 넉넉, 세로는 칩 높이만큼.
export const COL_GAP = 150;
export const ROW_GAP = 34;
export const FOCUS_ROW = 40;  // 포커스 행 간격
export const FOCUS_COL = 170; // 포커스 열 간격(라벨 폭 여유)

// 한 묶음을 x=0 중심의 격자 밴드로 배치. dir<0=위(importedBy), dir>0=아래(imports).
// 여러 열로 wrap → 개수 많아도 세로로 안 늘어짐(가로 공간 활용). 반환: 밴드가 쓴 행 수.
function placeBand(ids: string[], dir: number, pos: Map<string, Pos>, startRow: number): number {
  if (!ids.length) return 0;
  const cols = Math.min(8, Math.max(1, Math.round(Math.sqrt(ids.length * 1.6)))); // 대략 정사각·최대 8열
  ids.forEach((id, i) => {
    if (pos.has(id)) return;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * FOCUS_COL;                // 열을 x=0 기준 좌우 대칭
    const y = dir * (startRow + row) * FOCUS_ROW;               // 위/아래로 행 전개
    pos.set(id, { x, y });
  });
  return Math.ceil(ids.length / cols);
}

// 포커스 배치 — 선택 + 직접 이웃만. 의존 흐름 세로 정렬(결정적):
//   위  = importedBy(이 파일을 쓰는 것 = 상위/호출측)
//   중앙 = 선택 파일
//   아래 = imports(이 파일이 쓰는 것 = 하위/의존측)
export function focusLayout(graph: RepoGraph, focusId: string): Map<string, Pos> {
  const imports: string[] = [];
  const importedBy: string[] = [];
  for (const e of graph.edges) {
    if (e.source === focusId) imports.push(e.target);
    else if (e.target === focusId) importedBy.push(e.source);
  }
  const uniqSort = (a: string[]) => [...new Set(a)].sort();
  const imp = uniqSort(imports).filter((id) => id !== focusId);
  const by = uniqSort(importedBy).filter((id) => id !== focusId);

  const pos = new Map<string, Pos>();
  pos.set(focusId, { x: 0, y: 0 });        // 중앙 = 선택
  placeBand(by, -1, pos, 2);               // 위(startRow 2 = 선택과 한 칸 띄움)
  placeBand(imp.filter((id) => !pos.has(id)), 1, pos, 2); // 아래(순환 중복 제외)
  return pos;
}

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
