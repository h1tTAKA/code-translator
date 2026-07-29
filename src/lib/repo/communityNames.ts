// 커뮤니티 AI 이름 승계(#643) — 순수 로직. graphology 의존 없어 클라(RepoView)서 직접 import 가능.
// 재분석 시 커뮤니티 id는 크기순 재정규화되어 id로는 못 잇는다. 대신 멤버(파일) 집합의 겹침
// (Jaccard) 최대인 이전 커뮤니티를 찾아, 충분히 겹치고 그게 AI 이름(named)이면 승계.
// 파일이 크게 안 바뀐 커뮤니티는 이름 유지, 대개편된 것만 폴더 폴백으로 리셋(유저가 다시 이름 생성).
import type { RepoGraph } from "./types";

const CARRY_JACCARD = 0.5; // ponytail: 절반 이상 겹치면 같은 기능으로 봄. 튜닝 여지.

function membersByCommunity(g: RepoGraph): Map<number, Set<string>> {
  const m = new Map<number, Set<string>>();
  for (const n of g.nodes) {
    if (n.community == null) continue;
    (m.get(n.community) ?? m.set(n.community, new Set()).get(n.community)!).add(n.id);
  }
  return m;
}

// prev의 named 커뮤니티 이름을 next 커뮤니티에 멤버 겹침으로 승계한 새 그래프 반환.
// prev 없거나(첫 분석) root 다르면(다른 레포) next 그대로.
export function carryOverNames(prev: RepoGraph | null, next: RepoGraph): RepoGraph {
  const prevNamed = (prev?.communities ?? []).filter((c) => c.named);
  if (!prev || prev.root !== next.root || prevNamed.length === 0 || !next.communities) return next;

  const prevMembers = membersByCommunity(prev);
  const nextMembers = membersByCommunity(next);
  const prevLabel = new Map(prevNamed.map((c) => [c.id, c.label]));

  const communities = next.communities.map((c) => {
    const mine = nextMembers.get(c.id);
    if (!mine || mine.size === 0) return c;
    let best = 0, bestLabel: string | undefined;
    for (const [pid, plabel] of prevLabel) {
      const pset = prevMembers.get(pid);
      if (!pset) continue;
      let inter = 0;
      for (const f of mine) if (pset.has(f)) inter++;
      const jac = inter / (mine.size + pset.size - inter || 1);
      if (jac > best) { best = jac; bestLabel = plabel; }
    }
    return best >= CARRY_JACCARD && bestLabel ? { ...c, label: bestLabel, named: true } : c;
  });
  return { ...next, communities };
}
