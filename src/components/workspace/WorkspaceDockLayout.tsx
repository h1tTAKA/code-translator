"use client";
// 중앙 3패널 커스텀 도킹 레이아웃(#716) — 라이브러리 없이 "분할 트리"로 배치.
// 기존 패널(터미널·코드·문서) 컴포넌트를 그대로 렌더만 재배치. 디자인 변경 0.
// 커밋1: 트리 렌더 + split 리사이즈(기본 배치=현재와 동일). 드래그 도킹은 커밋2.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export type PanelId = "terminal" | "code" | "doc";
export type DockNode =
  | { t: "leaf"; panel: PanelId }
  | { t: "split"; dir: "row" | "col"; a: DockNode; b: DockNode; ratio: number }; // row=좌우, col=상하. ratio=a 자식 비율(0~1)

// 현재 존재하는 패널만으로 기본 트리 — 지금 화면과 동일하게(터미널 좌 | 코드 우, 문서는 코드 아래).
export function defaultTree(has: Record<PanelId, boolean>): DockNode {
  const term: DockNode = { t: "leaf", panel: "terminal" };
  let right: DockNode | null = null;
  if (has.code && has.doc) right = { t: "split", dir: "col", a: { t: "leaf", panel: "code" }, b: { t: "leaf", panel: "doc" }, ratio: 0.62 };
  else if (has.code) right = { t: "leaf", panel: "code" };
  else if (has.doc) right = { t: "leaf", panel: "doc" };
  return right ? { t: "split", dir: "row", a: term, b: right, ratio: 0.58 } : term;
}

// 트리에 있는 리프 패널 집합.
export function leavesOf(node: DockNode): Set<PanelId> {
  const out = new Set<PanelId>();
  const walk = (n: DockNode) => { if (n.t === "leaf") out.add(n.panel); else { walk(n.a); walk(n.b); } };
  walk(node);
  return out;
}

// 없어진 패널 리프 제거 후 형제를 부모 자리로 승격(prune). 전부 사라지면 null.
export function pruneTree(node: DockNode, has: Record<PanelId, boolean>): DockNode | null {
  if (node.t === "leaf") return has[node.panel] ? node : null;
  const a = pruneTree(node.a, has);
  const b = pruneTree(node.b, has);
  if (a && b) return { ...node, a, b };
  return a ?? b; // 한쪽만 남으면 그걸로 승격
}

// path("a"/"b" 배열)의 split ratio 갱신(불변).
function setRatioAt(node: DockNode, path: ("a" | "b")[], ratio: number): DockNode {
  if (path.length === 0) return node.t === "split" ? { ...node, ratio } : node;
  if (node.t !== "split") return node;
  const [head, ...rest] = path;
  return head === "a" ? { ...node, a: setRatioAt(node.a, rest, ratio) } : { ...node, b: setRatioAt(node.b, rest, ratio) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN_RATIO = 0.12;

export default function WorkspaceDockLayout({ tree, panels, onTreeChange }: {
  tree: DockNode;
  panels: Record<PanelId, ReactNode>;
  onTreeChange: (t: DockNode) => void;
}) {
  const treeRef = useRef(tree); // 드래그 move에서 최신 트리 읽기(closure stale 방지)
  useEffect(() => { treeRef.current = tree; }, [tree]);

  const renderNode = (node: DockNode, path: ("a" | "b")[]): ReactNode => {
    if (node.t === "leaf") return <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{panels[node.panel]}</div>;
    const isRow = node.dir === "row";
    const aBasis = `${node.ratio * 100}%`;
    const bBasis = `${(1 - node.ratio) * 100}%`;

    // 리사이즈 — 컨테이너 rect 기준 포인터 비율. 세로/가로에 따라 축 다름.
    const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = e.currentTarget.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const r = isRow ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        onTreeChange(setRatioAt(treeRef.current, path, clamp(r, MIN_RATIO, 1 - MIN_RATIO)));
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      document.body.style.cursor = isRow ? "col-resize" : "row-resize"; document.body.style.userSelect = "none";
    };

    return (
      <div className={`flex min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}>
        <div className="flex min-h-0 min-w-0" style={{ flexBasis: aBasis }}>{renderNode(node.a, [...path, "a"])}</div>
        <div onPointerDown={onDown}
          className={`shrink-0 bg-zinc-200 transition hover:bg-[#3B34E2]/40 dark:bg-zinc-800 dark:hover:bg-[#8b86f5]/40 ${isRow ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`} />
        <div className="flex min-h-0 min-w-0" style={{ flexBasis: bBasis }}>{renderNode(node.b, [...path, "b"])}</div>
      </div>
    );
  };

  return <div className="flex h-full min-h-0 w-full">{renderNode(tree, [])}</div>;
}
