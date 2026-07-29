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

// 멤버 파일들의 최다 상위 폴더(마지막 경로 조각) — community.ts의 자동 라벨과 동일 규칙.
// "AI 이름인지" 추론에 씀: label이 이 폴백과 다르면 사람이 붙인 이름.
function folderFallback(files: Set<string>): string {
  const seg = new Map<string, number>();
  for (const f of files) {
    const dir = f.split("/").slice(0, -1);
    const s = dir.length ? dir[dir.length - 1] : "(root)";
    seg.set(s, (seg.get(s) ?? 0) + 1);
  }
  let best = "", n = -1;
  for (const [s, c] of seg) if (c > n || (c === n && s < best)) { n = c; best = s; }
  return best;
}

// prev의 "이름 붙은" 커뮤니티를 next 커뮤니티에 멤버 겹침으로 승계한 새 그래프 반환.
// "이름 붙음" = named 플래그 true(#643 이후) 또는 label이 폴더 폴백과 다름(레거시 캐시 — 플래그 없이 붙인 AI 이름).
// prev 없거나(첫 분석) root 다르면(다른 레포) next 그대로.
export function carryOverNames(prev: RepoGraph | null, next: RepoGraph): RepoGraph {
  if (!prev || prev.root !== next.root || !prev.communities || !next.communities) return next;

  const prevMembers = membersByCommunity(prev);
  const nextMembers = membersByCommunity(next);
  const prevNamed = prev.communities.filter(
    (c) => c.named || c.label !== folderFallback(prevMembers.get(c.id) ?? new Set()),
  );
  if (prevNamed.length === 0) return next;
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
