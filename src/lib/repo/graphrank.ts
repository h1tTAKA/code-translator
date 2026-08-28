// 그래프 기반 검색(#853, 원안 서브3) — 쿼리 토큰으로 시드한 personalized PageRank.
// 임베딩 없이 그래프 연결 구조만으로 "관련 코드" 랭킹. "how does X work / who touches Y".
import type { RepoGraph } from "./types";

const DAMP = 0.85, ITER = 30;

// 쿼리 토큰(소문자, 2자+) 추출.
function tokens(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []);
}

export interface RankHit { id: string; score: number }

/**
 * personalized PageRank. seed = 라벨/파일이 쿼리 토큰 포함하는 노드에 가중.
 * seed 없으면 전역(균등) — 일반 중요도. imports/calls/contains/extends/implements 전부 간선으로(양방향 약하게).
 */
export function graphRank(graph: RepoGraph, query: string, topN = 20): RankHit[] {
  const ids = graph.nodes.map((n) => n.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const N = ids.length;
  if (!N) return [];
  // 시드 벡터
  const toks = tokens(query);
  const seed = new Float64Array(N);
  let seedSum = 0;
  graph.nodes.forEach((n, i) => {
    const hay = `${n.label} ${n.id}`.toLowerCase();
    if (toks.length && toks.some((t) => hay.includes(t))) { seed[i] = 1; seedSum += 1; }
  });
  if (seedSum === 0) { for (let i = 0; i < N; i++) seed[i] = 1 / N; } // 시드 없으면 균등
  else { for (let i = 0; i < N; i++) seed[i] /= seedSum; }
  // 인접(방향 무관 — 관련성 탐색이라 양방향). 자기루프 제외.
  const out: number[][] = Array.from({ length: N }, () => []);
  for (const e of graph.edges) {
    const s = idx.get(e.source), t = idx.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    out[s].push(t); out[t].push(s);
  }
  let rank = new Float64Array(seed);
  for (let it = 0; it < ITER; it++) {
    const next = new Float64Array(N);
    let dangling = 0;
    for (let i = 0; i < N; i++) {
      const deg = out[i].length;
      if (deg === 0) { dangling += rank[i]; continue; }
      const share = rank[i] / deg;
      for (const j of out[i]) next[j] += share;
    }
    for (let i = 0; i < N; i++) next[i] = (1 - DAMP) * seed[i] + DAMP * (next[i] + dangling * seed[i]);
    rank = next;
  }
  return ids
    .map((id, i) => ({ id, score: rank[i] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topN);
}
