// 기능 플로우 근거화(#842 서브4) — 코드그래프 실측 엣지에서 "주어진 파일들 사이의 연결"만 뽑는다.
// RepoFlowPane 노드는 file을 가짐 → 이 파일들 간 실제 imports/calls가 있으면 그 연결이 근거 있는 것.
// 순수 로직(fs·파싱 없음, 테스트 쉬움). graph는 서브1/2 산출(RepoGraph).
import type { RepoGraph } from "./types";

// 심볼 id("file#Sym") → 파일 경로. 파일 노드 id는 그대로 파일.
function fileOf(id: string): string {
  const h = id.indexOf("#");
  return h < 0 ? id : id.slice(0, h);
}

export interface FlowConnection {
  from: string;        // 파일 경로(주어진 files 중 하나)
  to: string;          // 파일 경로(주어진 files 중 하나)
  via: ("imports" | "calls")[]; // 이 방향 연결의 근거 관계(중복 제거)
}

/**
 * graph의 엣지 중 "files 안의 파일 → files 안의 다른 파일"인 것만 파일 단위로 집계.
 * imports(file→file)와 calls(symbol→symbol, 파일로 축약)를 근거로. 자기연결 제외.
 */
export function connectionsAmong(graph: RepoGraph, files: string[]): FlowConnection[] {
  const set = new Set(files);
  const map = new Map<string, Set<"imports" | "calls">>(); // "from|to" → 관계들
  for (const e of graph.edges) {
    if (e.relation !== "imports" && e.relation !== "calls") continue; // contains/extends/implements는 흐름 연결 아님
    const from = fileOf(e.source), to = fileOf(e.target);
    if (from === to) continue;               // 파일 내부 연결은 흐름 아님
    if (!set.has(from) || !set.has(to)) continue; // 플로우 노드 파일들 사이만
    const key = `${from}|${to}`;
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    s.add(e.relation);
  }
  const out: FlowConnection[] = [];
  for (const [key, rels] of map) {
    const [from, to] = key.split("|");
    out.push({ from, to, via: [...rels] });
  }
  return out;
}
