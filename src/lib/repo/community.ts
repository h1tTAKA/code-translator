// 커뮤니티 검출(자식6) — 서버(Node) 전용. Louvain으로 "실제 연결 촘촘한 논리 덩어리" 찾기.
// 폴더(물리 위치)와 별개. graphology-communities-louvain 사용. 결정적(정렬 삽입 + 시드 rng).
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { RepoGraph, Community } from "./types";

// 시드 고정 PRNG(mulberry32) — Louvain 랜덤 요소 결정화(같은 레포 = 같은 커뮤니티).
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function detectCommunities(graph: RepoGraph): { communities: Community[]; nodeCommunity: Map<string, number> } {
  const g = new Graph({ type: "undirected" });
  for (const n of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) g.addNode(n.id);
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.source === e.target || !g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`; // 무방향 dedup
    if (seen.has(key)) continue;
    seen.add(key);
    g.addUndirectedEdge(e.source, e.target);
  }

  // node → 커뮤니티 원본 index. 시드 rng로 결정적.
  const mapping = louvain(g, { rng: seededRng(1) }) as Record<string, number>;

  // 원본 index별 멤버 모으기.
  const byRaw = new Map<number, string[]>();
  for (const id of Object.keys(mapping)) {
    const c = mapping[id];
    (byRaw.get(c) ?? byRaw.set(c, []).get(c)!).push(id);
  }
  // 정규화: 크기 내림차순(동률 최소 id) → id 0,1,2...
  const ordered = [...byRaw.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    const am = [...a[1]].sort()[0], bm = [...b[1]].sort()[0];
    return am < bm ? -1 : am > bm ? 1 : 0;
  });

  const fileOf = new Map(graph.nodes.map((n) => [n.id, n.file ?? n.id]));
  const groupOf = new Map(graph.nodes.map((n) => [n.id, n.group ?? "(root)"]));
  const communities: Community[] = [];
  const nodeCommunity = new Map<string, number>();
  ordered.forEach(([, ids], newId) => {
    for (const id of ids) nodeCommunity.set(id, newId);
    // 라벨(간이) = 멤버 파일들의 가장 흔한 상위 폴더(마지막 경로 조각). 모노레포서 "apps" 도배 방지.
    // (기능적 라벨은 LLM 후속.)
    const seg = new Map<string, number>();
    for (const id of ids) {
      const dir = (fileOf.get(id) ?? id).split("/").slice(0, -1);
      const s = dir.length ? dir[dir.length - 1] : (groupOf.get(id) ?? "(root)");
      seg.set(s, (seg.get(s) ?? 0) + 1);
    }
    const label = [...seg.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    communities.push({ id: newId, label, count: ids.length });
  });
  return { communities, nodeCommunity };
}
