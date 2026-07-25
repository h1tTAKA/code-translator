// community.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/community.check.ts
import assert from "node:assert";
import { detectCommunities } from "./community.ts";
import type { RepoGraph, RepoEdge } from "./types.ts";

// 두 덩어리: {A,B,C} 빽빽 + {X,Y,Z} 빽빽, 사이 다리 1개(C-X).
const e = (s: string, t: string): RepoEdge => ({ source: s, target: t, relation: "imports" });
const g: RepoGraph = {
  root: "/x",
  nodes: ["A", "B", "C", "X", "Y", "Z"].map((id) => ({ id, label: id, file: id, kind: "file", group: id < "X" ? "left" : "right" })),
  edges: [e("A", "B"), e("B", "C"), e("A", "C"), e("X", "Y"), e("Y", "Z"), e("X", "Z"), e("C", "X")],
  stats: { files: 6, edges: 7, scanned: 6, capped: false },
};

const r1 = detectCommunities(g);
// 전 노드 배정.
assert.strictEqual(r1.nodeCommunity.size, 6, "전 노드 커뮤니티 배정");
// 커버: 커뮤니티 count 합 = 노드 수.
assert.strictEqual(r1.communities.reduce((s, c) => s + c.count, 0), 6, "count 합 = 6");
// 결정적: 두 번 호출 동일.
const r2 = detectCommunities(g);
for (const [id, c] of r1.nodeCommunity) assert.strictEqual(c, r2.nodeCommunity.get(id), `${id} 결정적`);
assert.deepStrictEqual(r1.communities, r2.communities, "communities 결정적");
// 두 덩어리 분리: A와 X는 다른 커뮤니티(다리 1개뿐).
assert.notStrictEqual(r1.nodeCommunity.get("A"), r1.nodeCommunity.get("X"), "A·X 다른 커뮤니티");
// 같은 덩어리: A,B,C 동일.
assert.strictEqual(r1.nodeCommunity.get("A"), r1.nodeCommunity.get("B"), "A·B 같은 커뮤니티");
assert.strictEqual(r1.nodeCommunity.get("B"), r1.nodeCommunity.get("C"), "B·C 같은 커뮤니티");
// id 0..k-1 연속, 크기 내림차순.
r1.communities.forEach((c, i) => assert.strictEqual(c.id, i, "id 연속"));

console.log("community.check OK");
