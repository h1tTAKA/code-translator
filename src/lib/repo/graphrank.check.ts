// graphRank 점검 — node --experimental-strip-types src/lib/repo/graphrank.check.ts
import assert from "node:assert";
import { graphRank } from "./graphrank.ts";
import type { RepoGraph } from "./types.ts";

// hub가 여러 노드와 연결 → 무시드(균등) 시 hub가 상위여야.
const g = {
  nodes: [
    { id: "hub", label: "hub", file: "hub.ts", kind: "function" as const },
    { id: "a", label: "alpha", file: "a.ts", kind: "function" as const },
    { id: "b", label: "beta", file: "b.ts", kind: "function" as const },
    { id: "c", label: "gamma", file: "c.ts", kind: "function" as const },
    { id: "lonely", label: "lonely", file: "z.ts", kind: "function" as const },
  ],
  edges: [
    { source: "a", target: "hub", relation: "calls" as const },
    { source: "b", target: "hub", relation: "calls" as const },
    { source: "c", target: "hub", relation: "calls" as const },
  ],
} as unknown as RepoGraph;

// 무시드: 연결 많은 hub가 1위, lonely(고립)가 꼴찌.
const uniform = graphRank(g, "", 10);
assert.equal(uniform[0].id, "hub", `hub이 최상위여야 (got ${uniform[0].id})`);
assert.equal(uniform[uniform.length - 1].id, "lonely", "고립 노드 꼴찌");

// 시드: 쿼리 토큰이 alpha 라벨 매칭 → alpha 점수 부각(무시드 대비 상승).
const seeded = graphRank(g, "alpha", 10);
const rankOf = (hits: { id: string }[], id: string) => hits.findIndex((h) => h.id === id);
assert.ok(rankOf(seeded, "a") <= rankOf(uniform, "a"), "alpha 시드 시 순위 상승/유지");
assert.ok(seeded.length === 5, "노드 수만큼 반환");

console.log("graphrank.check OK");
