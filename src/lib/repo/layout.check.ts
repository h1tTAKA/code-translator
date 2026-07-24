// layout.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/layout.check.ts
import assert from "node:assert";
import { computeLayout } from "./layout.ts";
import type { RepoGraph } from "./types.ts";

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

console.log("layout.check OK");
