// 레포 분석 그래프 스키마(부모 #585). graphify graph.json 형태 차용.
// 자식 #590은 파일 노드 + import 엣지까지. 심볼(function/component)·calls는 후속.

export type RepoNodeKind = "file" | "function" | "component" | "class" | "type";
export type RepoRelation = "imports" | "calls" | "contains" | "extends";

export interface RepoNode {
  id: string;        // 레포 루트 기준 상대경로(파일 노드) — 고유 키
  label: string;     // 표시명(파일명)
  file: string;      // 상대경로(파일)
  kind: RepoNodeKind;
  group?: string;    // 군집(자식3은 최상위 폴더 기준 임시)
  community?: number; // 커뮤니티 id(Louvain, 자식6) — 실제 연결 촘촘한 논리 덩어리
}

// 커뮤니티(자식6) — Louvain 검출한 논리 덩어리.
export interface Community {
  id: number;      // 0..k-1 (크기 내림차순 정규화)
  label: string;   // 라벨 — 기본 자동(멤버 최다 폴더), AI 이름 붙으면 그것으로 대체
  count: number;   // 멤버 수
  named?: boolean; // true=LLM이 붙인 기능 이름(#643). 재분석 시 멤버 겹침으로 승계·증분 라벨 판별
}

export interface RepoEdge {
  source: string;    // RepoNode.id
  target: string;    // RepoNode.id
  relation: RepoRelation;
}

export interface RepoGraph {
  root: string;              // 분석한 레포 절대경로
  nodes: RepoNode[];
  edges: RepoEdge[];
  stats: {
    files: number;           // 그래프에 든 파일 수
    edges: number;
    scanned: number;         // 스캔한 총 지원 파일 수(상한 적용 전)
    capped: boolean;         // 상한에 걸려 잘렸는지
    reparsed?: number;       // 이번 빌드서 실제 재파싱한 파일 수(증분 — 나머지는 캐시 재사용)
  };
  communities?: Community[]; // 커뮤니티 목록(자식6)
}
