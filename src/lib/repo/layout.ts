import type { RepoGraph } from "./types";

// 그래프 배치 모드 — 관계(grid)·흐름(layers)·구성(treemap).
export type LayoutMode = "grid" | "layers" | "treemap";
export const LAYOUT_MODES: LayoutMode[] = ["grid", "layers", "treemap"];

export interface Pos { x: number; y: number }
// 폴더 구역(그리드맵) 사각형 — 경계·라벨 그리기용.
export interface Region { group: string; label: string; x: number; y: number; w: number; h: number }

// 노드 간격(그래프 좌표계 px) — 라벨 칩이 가로로 기니 가로 넉넉, 세로는 칩 높이만큼.
export const COL_GAP = 150;
export const ROW_GAP = 34;
export const FOCUS_ROW = 40;  // 포커스 행 간격
export const FOCUS_COL = 170; // 포커스 열 간격(라벨 폭 여유)
// 폴더 구역 여백/간격
export const REGION_PAD_X = COL_GAP * 0.5;   // 좌우 여백
export const REGION_PAD_TOP = ROW_GAP * 2;   // 상단 라벨 밴드
const REGION_PAD_BOT = ROW_GAP * 0.5;        // 하단 여백
const REGION_GAP = COL_GAP * 0.8;            // 구역 사이 간격

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

// 레이어(층) 배치 — 의존 방향 위→아래. 위=진입점(아무도 안 씀), 아래=피의존(공통 util).
// edge s→t = s가 t를 import(s가 t에 기댐) → s가 t보다 위. 결정적.
export const LAYER_GAP = 80; // 층 간 세로 간격(그래프 좌표)

export function layeredLayout(graph: RepoGraph): { pos: Map<string, Pos> } {
  const ids = graph.nodes.map((n) => n.id);
  const groupOf = new Map(graph.nodes.map((n) => [n.id, n.group ?? "(root)"]));

  // 인접(succ: s→[t...]) — 중복 엣지 제거.
  const succ = new Map<string, string[]>();
  for (const id of ids) succ.set(id, []);
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!succ.has(e.source) || !succ.has(e.target)) continue; // 노드셋 밖 방어
    const key = `${e.source}|${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    succ.get(e.source)!.push(e.target);
  }

  // 1) DFS 3색(흰0/회1/검2)으로 back edge(사이클 유발) 표시 — 층 계산서만 무시(DAG화).
  const color = new Map<string, number>(ids.map((id) => [id, 0]));
  const back = new Set<string>();
  for (const root of ids) {
    if (color.get(root) !== 0) continue;
    color.set(root, 1);
    const stack: { node: string; i: number }[] = [{ node: root, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = succ.get(top.node)!;
      if (top.i < outs.length) {
        const v = outs[top.i++];
        const cv = color.get(v);
        if (cv === 1) back.add(`${top.node}|${v}`);       // 방문 중(회색)으로 되돌아감 = 사이클
        else if (cv === 0) { color.set(v, 1); stack.push({ node: v, i: 0 }); }
      } else {
        color.set(top.node, 2);
        stack.pop();
      }
    }
  }

  // 2) longest-path 층배정 — DAG(back 제외) 위상정렬(Kahn)로 층 누적.
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [s, outs] of succ) for (const t of outs) if (!back.has(`${s}|${t}`)) indeg.set(t, indeg.get(t)! + 1);
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0).sort(); // 결정적
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    for (const v of succ.get(u)!) {
      if (back.has(`${u}|${v}`)) continue;
      if (layer.get(u)! + 1 > layer.get(v)!) layer.set(v, layer.get(u)! + 1);
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }

  // 3) 층별 버킷 + 층 내 초기 정렬(group→id, 결정적).
  const buckets = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id)!;
    (buckets.get(l) ?? buckets.set(l, []).get(l)!).push(id);
  }
  const layers = [...buckets.keys()].sort((a, b) => a - b);
  for (const l of layers) buckets.get(l)!.sort((a, b) => {
    const ga = groupOf.get(a)!, gb = groupOf.get(b)!;
    return ga < gb ? -1 : ga > gb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });

  // x 좌표(층 내 인덱스 중앙정렬). barycenter가 순서를 바꾸면 다시 부여.
  const xOf = new Map<string, number>();
  const assignX = (bucket: string[]) => {
    const m = bucket.length;
    bucket.forEach((id, i) => xOf.set(id, (i - (m - 1) / 2) * COL_GAP));
  };
  for (const l of layers) assignX(buckets.get(l)!);

  // 4) barycenter 교차 완화 — 위층 이웃(preds=importers) / 아래층 이웃(succs) 평균 x로 층 내 재정렬.
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succsF = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [s, outs] of succ) for (const t of outs) if (!back.has(`${s}|${t}`)) { succsF.get(s)!.push(t); preds.get(t)!.push(s); }
  const bary = (id: string, ref: Map<string, string[]>): number => {
    const ns = ref.get(id)!;
    if (!ns.length) return xOf.get(id)!;              // 이웃 없으면 제자리(안 튐)
    let sum = 0; for (const n of ns) sum += xOf.get(n)!;
    return sum / ns.length;
  };
  const reorder = (bucket: string[], ref: Map<string, string[]>) => {
    bucket.sort((a, b) => {
      const ba = bary(a, ref), bb = bary(b, ref);
      return ba !== bb ? ba - bb : a < b ? -1 : a > b ? 1 : 0; // 동률 tie-break=id(결정적)
    });
    assignX(bucket);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < layers.length; i++) reorder(buckets.get(layers[i])!, preds);           // 아래로: 위층 기준
    for (let i = layers.length - 2; i >= 0; i--) reorder(buckets.get(layers[i])!, succsF);      // 위로: 아래층 기준
  }

  const pos = new Map<string, Pos>();
  for (const l of layers) for (const id of buckets.get(l)!) pos.set(id, { x: xOf.get(id)!, y: l * LAYER_GAP });
  return { pos };
}

// 결정적 배치 — 같은 그래프+모드 → 같은 좌표(새로고침·재렌더에도 위치 유지).
// grid=폴더 구역 배치. layers=의존 층. treemap(자식4)은 우선 폴더 구역으로 폴백.
export function computeLayout(graph: RepoGraph, mode: LayoutMode): Map<string, Pos> {
  switch (mode) {
    case "layers":
      return layeredLayout(graph).pos;
    case "treemap": // 자식4
    case "grid":
    default:
      return folderRegionLayout(graph).pos;
  }
}

// 폴더 구역 배치 — 각 최상위 폴더가 자기 사각 구역(안에 파일 격자), 구역들을 shelf-pack 메타그리드로.
// 결정적(그룹 정렬 '(root)' 먼저·id 정렬). 반환: 노드 좌표 + 구역 사각형 목록(경계/라벨 렌더용).
export function folderRegionLayout(graph: RepoGraph): { pos: Map<string, Pos>; regions: Region[] } {
  // 그룹별 노드 id 수집.
  const byGroup = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const g = n.group ?? "(root)";
    const arr = byGroup.get(g);
    if (arr) arr.push(n.id); else byGroup.set(g, [n.id]);
  }
  // 그룹 정렬: '(root)' 먼저, 나머지 알파벳.
  const groups = [...byGroup.keys()].sort((a, b) =>
    a === "(root)" ? -1 : b === "(root)" ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );

  // 각 폴더의 내부 격자 크기(로컬) 선계산.
  const plans = groups.map((g) => {
    const ids = [...byGroup.get(g)!].sort();
    const nCols = Math.max(1, Math.round(Math.sqrt((ids.length * ROW_GAP) / COL_GAP)));
    const nRows = Math.ceil(ids.length / nCols);
    const w = nCols * COL_GAP + 2 * REGION_PAD_X;
    const h = nRows * ROW_GAP + REGION_PAD_TOP + REGION_PAD_BOT;
    return { group: g, ids, nCols, w, h };
  });

  // 메타그리드 shelf-pack — 행 높이=행 내 최대 h, x는 w+GAP, 행 넘치면 y 내림.
  const metaCols = Math.max(1, Math.round(Math.sqrt(plans.length)));
  const pos = new Map<string, Pos>();
  const regions: Region[] = [];
  let cursorX = 0, rowY = 0, rowH = 0, colInRow = 0;
  for (const p of plans) {
    if (colInRow >= metaCols) { rowY += rowH + REGION_GAP; cursorX = 0; rowH = 0; colInRow = 0; }
    const ox = cursorX, oy = rowY;
    regions.push({ group: p.group, label: p.group, x: ox, y: oy, w: p.w, h: p.h });
    p.ids.forEach((id, i) => {
      const col = i % p.nCols, row = Math.floor(i / p.nCols);
      pos.set(id, {
        x: ox + REGION_PAD_X + col * COL_GAP + COL_GAP / 2, // 칩 중앙정렬 보정
        y: oy + REGION_PAD_TOP + row * ROW_GAP + ROW_GAP / 2,
      });
    });
    cursorX += p.w + REGION_GAP;
    rowH = Math.max(rowH, p.h);
    colInRow++;
  }
  return { pos, regions };
}
