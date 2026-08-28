// 아키텍처 분석용 그래프 다이제스트(#842 서브3) — 코드그래프를 LLM 프롬프트용 "실측 구조 요약"으로 압축.
// 파일 목록만 주던 분석(카테고리·플로우)에 진짜 모듈 경계·허브·의존을 덧대 정확·완결하게.
// 순수 로직(fs·파싱 없음). 허브 = degree(연결 수) — PageRank는 검색(서브6)에서. ponytail: degree로 충분.
import type { RepoGraph } from "./types";

export interface DigestOpts {
  moduleDepth?: number;   // 모듈 키 = 파일 디렉토리 상위 N세그먼트
  maxModules?: number;    // 모듈 나열 상한
  perModuleHubs?: number; // 모듈별 허브 파일 수
  topHubs?: number;       // 전체 핵심 허브 수
  topModuleEdges?: number;// 모듈간 의존 나열 상한
}
const DEF: Required<DigestOpts> = { moduleDepth: 3, maxModules: 40, perModuleHubs: 3, topHubs: 15, topModuleEdges: 30 };
const SEP = "\u0000"; // 모듈쌍 키 구분자 — 경로에 절대 없는 NUL(공백 포함 경로도 안전, cavecrew 🔴)

const fileOf = (id: string) => { const h = id.indexOf("#"); return h < 0 ? id : id.slice(0, h); };
// 일반명(route/page/layout/index/__init__)은 App Router 등서 충돌 → 부모폴더 포함해 구분.
const GENERIC = /^(route|page|layout|template|loading|error|index|__init__)\.\w+$/;
const baseOf = (f: string) => {
  const segs = f.split("/").filter(Boolean);
  const b = segs[segs.length - 1] ?? f;
  return GENERIC.test(b) && segs.length > 1 ? `${segs[segs.length - 2]}/${b}` : b;
};
function moduleOf(file: string, depth: number): string {
  const segs = file.split("/").filter(Boolean);
  const dir = segs.slice(0, -1);              // 파일명 제외
  return dir.length ? dir.slice(0, depth).join("/") : "(root)";
}

/** 그래프 → LLM용 압축 구조 요약 문자열(모듈맵 + 모듈간 의존 + 핵심 허브). 상한 초과분은 절삭 표기(silent 금지). */
export function graphDigest(graph: RepoGraph, opts: DigestOpts = {}): string {
  const o = { ...DEF, ...opts };
  // 파일 집합(모든 노드의 file)
  const files = new Set<string>();
  for (const n of graph.nodes) if (n.file) files.add(n.file);
  // 파일 degree(다른 파일과의 imports/calls 연결 수) + 모듈간 import 엣지
  const deg = new Map<string, number>();
  const modEdge = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of graph.edges) {
    if (e.relation !== "imports" && e.relation !== "calls") continue;
    const fa = fileOf(e.source), fb = fileOf(e.target);
    if (fa === fb) continue;
    bump(deg, fa); bump(deg, fb);
    if (e.relation === "imports") {
      const ma = moduleOf(fa, o.moduleDepth), mb = moduleOf(fb, o.moduleDepth);
      if (ma !== mb) bump(modEdge, `${ma}${SEP}${mb}`);
    }
  }
  // 모듈별 파일 묶기
  const modFiles = new Map<string, string[]>();
  for (const f of files) { const m = moduleOf(f, o.moduleDepth); const a = modFiles.get(m) ?? []; a.push(f); modFiles.set(m, a); }
  // 모듈 정렬: 파일 많은 순, 동률 이름순
  const mods = [...modFiles.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const topHub = (fs: string[], n: number) =>
    [...fs].sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b)).slice(0, n).map(baseOf);

  const lines: string[] = [];
  lines.push("[모듈 구조 — 실측 코드그래프]");
  for (const [m, fs] of mods.slice(0, o.maxModules)) {
    const hubs = topHub(fs, o.perModuleHubs).join(", ");
    lines.push(`${m} (${fs.length} files)${hubs ? ` · 허브: ${hubs}` : ""}`);
  }
  if (mods.length > o.maxModules) lines.push(`(+${mods.length - o.maxModules} more modules)`);

  const edges = [...modEdge.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (edges.length) {
    lines.push("", "[모듈 의존(import)]");
    for (const [k, c] of edges.slice(0, o.topModuleEdges)) { const [a, b] = k.split(SEP); lines.push(`${a} → ${b} (${c})`); }
    if (edges.length > o.topModuleEdges) lines.push(`(+${edges.length - o.topModuleEdges} more)`);
  }

  const hubs = [...deg.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, o.topHubs);
  if (hubs.length) {
    lines.push("", "[핵심 허브 파일(연결 많음)]");
    hubs.forEach(([f, d], i) => lines.push(`${i + 1}. ${f} (deg ${d})`));
  }
  return lines.join("\n");
}
