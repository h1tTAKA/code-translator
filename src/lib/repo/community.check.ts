// community.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/community.check.ts
import assert from "node:assert";
import { detectCommunities } from "./community.ts";
import { carryOverNames } from "./communityNames.ts";
import type { RepoGraph, RepoEdge, Community } from "./types.ts";

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

// --- carryOverNames(#643) ---
// prev: 커뮤니티0 = {A,B,C}에 AI 이름 "인증". next: 파일 거의 같은 커뮤니티(멤버 겹침 큼) → 승계.
const mk = (root: string, comm: Record<string, number>, communities: Community[]): RepoGraph => ({
  root,
  nodes: Object.entries(comm).map(([id, c]) => ({ id, label: id, file: id, kind: "file" as const, community: c })),
  edges: [],
  stats: { files: Object.keys(comm).length, edges: 0, scanned: 0, capped: false },
  communities,
});
// 커뮤니티1은 폴더 "ui/" 아래라 폴백="ui"=label → 이름 아님(승계 대상 X).
const prev = mk("/r", { A: 0, B: 0, C: 0, "ui/X": 1, "ui/Y": 1 }, [
  { id: 0, label: "인증", count: 3, named: true },
  { id: 1, label: "ui", count: 2 },
]);
// next: 같은 root, 커뮤니티0 멤버 {A,B,C,D}(4중 3 겹침 = Jaccard 3/4=0.75 ≥0.5) → "인증" 승계.
const next = mk("/r", { A: 0, B: 0, C: 0, D: 0, "ui/X": 1, "ui/Y": 1 }, [
  { id: 0, label: "app", count: 4 },
  { id: 1, label: "ui", count: 2 },
]);
const carried = carryOverNames(prev, next);
assert.strictEqual(carried.communities![0].label, "인증", "멤버 겹침 큰 커뮤니티 AI 이름 승계");
assert.strictEqual(carried.communities![0].named, true, "승계 시 named 표식");
assert.strictEqual(carried.communities![1].named, undefined, "이름 아니던 건 미승계");

// root 다르면(다른 레포) 미승계.
const other = carryOverNames(prev, mk("/other", { A: 0, B: 0, C: 0 }, [{ id: 0, label: "app", count: 3 }]));
assert.strictEqual(other.communities![0].label, "app", "다른 레포 미승계");

// 겹침 부족(대개편) → 미승계. next 커뮤니티0 = {P,Q,R}(prev {A,B,C}와 0 겹침).
const reshuffled = carryOverNames(prev, mk("/r", { P: 0, Q: 0, R: 0 }, [{ id: 0, label: "new", count: 3 }]));
assert.strictEqual(reshuffled.communities![0].label, "new", "겹침 없으면 미승계(리셋)");

// prev 없으면 그대로.
assert.strictEqual(carryOverNames(null, next).communities![0].label, "app", "prev 없으면 그대로");

// 레거시(named 플래그 없이 AI 이름만 있던 옛 캐시) — label이 폴더 폴백과 달라 이름으로 추론·승계.
// prev 멤버 A,B,C 폴더 폴백="src"(파일 src/A 등)인데 label="인증"(다름) → named 없어도 승계.
const legacyPrev: RepoGraph = {
  root: "/r",
  nodes: [["src/A",0],["src/B",0],["src/C",0],["ui/X",1],["ui/Y",1]].map(([id,c]) => ({ id: id as string, label: (id as string), file: id as string, kind: "file" as const, community: c as number })),
  edges: [],
  stats: { files: 5, edges: 0, scanned: 0, capped: false },
  communities: [{ id: 0, label: "인증", count: 3 }, { id: 1, label: "ui", count: 2 }], // named 없음(레거시). id1 label="ui"=폴더폴백이라 이름 아님
};
const legacyNext = mk("/r", { "src/A": 0, "src/B": 0, "src/C": 0, "src/D": 0, "ui/X": 1, "ui/Y": 1 }, [
  { id: 0, label: "src", count: 4 },
  { id: 1, label: "ui", count: 2 },
]);
const lc = carryOverNames(legacyPrev, legacyNext);
assert.strictEqual(lc.communities![0].label, "인증", "레거시 AI 이름(폴더폴백과 다름) 승계");
assert.strictEqual(lc.communities![1].label, "ui", "폴더폴백과 같은 건 이름 아님 → 미승계(그대로)");

console.log("community.check OK");
