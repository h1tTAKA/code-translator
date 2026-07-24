// layout.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/layout.check.ts
import assert from "node:assert";
import { computeLayout, focusLayout } from "./layout.ts";
import type { RepoGraph, RepoEdge } from "./types.ts";

const g: RepoGraph = {
  root: "/x",
  nodes: ["src/a.ts", "src/b.ts", "lib/c.ts", "lib/d.ts", "e.ts"].map((id) => ({ id, label: id.split("/").pop()!, file: id, kind: "file" })),
  edges: [],
  stats: { files: 5, edges: 0, scanned: 5, capped: false },
};

const p1 = computeLayout(g, "grid");
assert.strictEqual(p1.size, 5, "전 노드 배치");

// 결정적 — 두 번 호출 동일 좌표.
const p2 = computeLayout(g, "grid");
for (const [id, pos] of p1) {
  assert.deepStrictEqual(pos, p2.get(id), `${id} 결정적`);
}

// 좌표 유니크(겹침 없음).
const seen = new Set<string>();
for (const { x, y } of p1.values()) {
  const key = `${x},${y}`;
  assert.ok(!seen.has(key), `좌표 유니크 ${key}`);
  seen.add(key);
}

// focusLayout — 선택 B: A→B, B→C, B→D, E→B.  imports(B가 씀)=C,D / importedBy(B를 씀)=A,E.
const edge = (source: string, target: string): RepoEdge => ({ source, target, relation: "imports" });
const fg: RepoGraph = {
  root: "/x",
  nodes: ["A", "B", "C", "D", "E", "Z"].map((id) => ({ id, label: id, file: id, kind: "file" })),
  edges: [edge("A", "B"), edge("B", "C"), edge("B", "D"), edge("E", "B"), edge("A", "Z")],
  stats: { files: 6, edges: 5, scanned: 6, capped: false },
};
const f1 = focusLayout(fg, "B");
assert.deepStrictEqual([...f1.keys()].sort(), ["A", "B", "C", "D", "E"], "선택+이웃만(Z 제외)");
assert.deepStrictEqual(f1.get("B"), { x: 0, y: 0 }, "선택 노드 맨 위");
// 결정적.
const f2 = focusLayout(fg, "B");
for (const [id, p] of f1) assert.deepStrictEqual(p, f2.get(id), `${id} 결정적`);
// y 유니크(세로 열, 겹침 없음).
const ys = new Set<number>();
for (const { y } of f1.values()) { assert.ok(!ys.has(y), `y 유니크 ${y}`); ys.add(y); }

console.log("layout.check OK");
