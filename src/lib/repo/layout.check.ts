// layout.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/layout.check.ts
import assert from "node:assert";
import { computeLayout, focusLayout, folderRegionLayout, layeredLayout, treemapLayout } from "./layout.ts";
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
assert.deepStrictEqual(f1.get("B"), { x: 0, y: 0 }, "선택 노드 = 중앙(0,0)");
// 흐름 밴드: importedBy(A,E)=위(y<0), imports(C,D)=아래(y>0).
assert.ok(f1.get("A")!.y < 0 && f1.get("E")!.y < 0, "importedBy(A,E) 위쪽 y<0");
assert.ok(f1.get("C")!.y > 0 && f1.get("D")!.y > 0, "imports(C,D) 아래쪽 y>0");
// 결정적.
const f2 = focusLayout(fg, "B");
for (const [id, p] of f1) assert.deepStrictEqual(p, f2.get(id), `${id} 결정적`);
// 좌표 유니크(겹침 없음).
const seen2 = new Set<string>();
for (const { x, y } of f1.values()) { const k = `${x},${y}`; assert.ok(!seen2.has(k), `유니크 ${k}`); seen2.add(k); }

// folderRegionLayout — 그룹 있는 픽스처.
const rg: RepoGraph = {
  root: "/x",
  nodes: [
    { id: "app/page.tsx", label: "page.tsx", file: "app/page.tsx", kind: "file", group: "app" },
    { id: "app/layout.tsx", label: "layout.tsx", file: "app/layout.tsx", kind: "file", group: "app" },
    { id: "lib/a.ts", label: "a.ts", file: "lib/a.ts", kind: "file", group: "lib" },
    { id: "lib/b.ts", label: "b.ts", file: "lib/b.ts", kind: "file", group: "lib" },
    { id: "lib/c.ts", label: "c.ts", file: "lib/c.ts", kind: "file", group: "lib" },
    { id: "root.ts", label: "root.ts", file: "root.ts", kind: "file" }, // group 없음 → (root)
  ],
  edges: [],
  stats: { files: 6, edges: 0, scanned: 6, capped: false },
};

const r1 = folderRegionLayout(rg);
// 결정적 — pos·regions 두 번 동일.
const r2 = folderRegionLayout(rg);
for (const [id, p] of r1.pos) assert.deepStrictEqual(p, r2.pos.get(id), `${id} pos 결정적`);
assert.deepStrictEqual(r1.regions, r2.regions, "regions 결정적");
assert.strictEqual(r1.pos.size, 6, "전 노드 배치");
assert.strictEqual(r1.regions.length, 3, "구역 3개(app/lib/(root))");
assert.strictEqual(r1.regions[0].group, "(root)", "'(root)' 먼저");

// 각 노드는 자기 그룹 구역 안.
const regionOf = new Map(r1.regions.map((r) => [r.group, r]));
for (const n of rg.nodes) {
  const p = r1.pos.get(n.id)!;
  const r = regionOf.get(n.group ?? "(root)")!;
  assert.ok(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h, `${n.id} 구역 안`);
}
// 구역 쌍 비겹침(AABB).
for (let i = 0; i < r1.regions.length; i++) for (let j = i + 1; j < r1.regions.length; j++) {
  const a = r1.regions[i], b = r1.regions[j];
  const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.ok(!overlap, `구역 ${a.group}·${b.group} 비겹침`);
}
// computeLayout grid는 folderRegionLayout.pos와 동일(라우팅).
const gl = computeLayout(rg, "grid");
assert.strictEqual(gl.size, 6, "grid 전 노드");
for (const [id, p] of gl) assert.deepStrictEqual(p, r1.pos.get(id), `${id} grid=region 라우팅`);

// layeredLayout — 사이클 포함 그래프(A→B→C→A + D→A, E 고립).
const led = (s: string, t: string): RepoEdge => ({ source: s, target: t, relation: "imports" });
const lg: RepoGraph = {
  root: "/x",
  nodes: ["A", "B", "C", "D", "E"].map((id) => ({ id, label: id, file: id, kind: "file" })),
  edges: [led("A", "B"), led("B", "C"), led("C", "A"), led("D", "A")], // C→A = 사이클
  stats: { files: 5, edges: 4, scanned: 5, capped: false },
};
const L1 = layeredLayout(lg).pos;         // 무한루프 없이 반환돼야(사이클 끊기)
assert.strictEqual(L1.size, 5, "전 노드 배치");
// 결정적.
const L2 = layeredLayout(lg).pos;
for (const [id, p] of L1) assert.deepStrictEqual(p, L2.get(id), `${id} 결정적`);
// 비 back-edge 층 단조: source 층 < target 층. (C→A는 back이라 제외.)
const yOf = (id: string) => L1.get(id)!.y;
assert.ok(yOf("A") < yOf("B"), "A→B: A 위");
assert.ok(yOf("B") < yOf("C"), "B→C: B 위");
assert.ok(yOf("D") < yOf("A"), "D→A: D 위(진입점)");
// 좌표 유니크.
const lseen = new Set<string>();
for (const { x, y } of L1.values()) { const k = `${x},${y}`; assert.ok(!lseen.has(k), `유니크 ${k}`); lseen.add(k); }
// computeLayout layers 라우팅.
assert.strictEqual(computeLayout(lg, "layers").size, 5, "layers 라우팅");

// treemapLayout — 앞 folderRegionLayout 픽스처(rg) 재사용(app 2·lib 3·(root) 1).
const W = 1600, H = 900;
const t1 = treemapLayout(rg, W, H);
const t2 = treemapLayout(rg, W, H);
// 결정적.
for (const [id, p] of t1.pos) assert.deepStrictEqual(p, t2.pos.get(id), `treemap ${id} pos 결정적`);
assert.deepStrictEqual(t1.regions, t2.regions, "treemap regions 결정적");
assert.strictEqual(t1.pos.size, 6, "treemap 전 노드");
assert.strictEqual(t1.regions.length, 3, "treemap 구역 3개");
// 면적 ∝ 파일 수: lib(3) 박스 면적 > app(2) > (root)(1).
const areaOf = new Map(t1.regions.map((r) => [r.group, r.w * r.h]));
assert.ok(areaOf.get("lib")! > areaOf.get("app")!, "lib(3) > app(2) 면적");
assert.ok(areaOf.get("app")! > areaOf.get("(root)")!, "app(2) > (root)(1) 면적");
// 타일링: 구역 면적 합 ≈ W*H(패딩 없이 꽉 채움).
const sumArea = t1.regions.reduce((s, r) => s + r.w * r.h, 0);
assert.ok(Math.abs(sumArea - W * H) < 1, `타일링 면적합 ${sumArea}≈${W * H}`);
// 각 노드 자기 구역 안.
const tRegionOf = new Map(t1.regions.map((r) => [r.group, r]));
for (const n of rg.nodes) {
  const p = t1.pos.get(n.id)!, r = tRegionOf.get(n.group ?? "(root)")!;
  assert.ok(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h, `treemap ${n.id} 구역 안`);
}
// 구역 비겹침(AABB, 맞닿음은 허용 — 엄격 겹침만).
for (let i = 0; i < t1.regions.length; i++) for (let j = i + 1; j < t1.regions.length; j++) {
  const a = t1.regions[i], b = t1.regions[j];
  const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
  assert.ok(!overlap, `treemap ${a.group}·${b.group} 비겹침`);
}
// computeLayout treemap 라우팅.
assert.strictEqual(computeLayout(rg, "treemap").size, 6, "treemap 라우팅");

console.log("layout.check OK");
