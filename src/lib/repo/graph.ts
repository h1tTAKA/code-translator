// import 그래프 빌더 — 서버(Node) 전용. 스캔한 파일들의 import를 뽑아 파일 노드 + imports 엣지로.
// 언어별 추출기(langs.ts)로 dispatch — TS/JS는 컴파일러 API, 나머지는 경량 정규식. 심볼레벨(calls)은 후속.
import { readFileSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { scanRepo } from "./scan";
import { detectLang, SUPPORTED_EXTS } from "./langs";
import { reconcile, type FileCache } from "./incremental";
import { detectCommunities } from "./community";
import type { RepoGraph, RepoNode, RepoEdge } from "./types";

// 해석 시 붙여볼 확장자 — 지원 언어 전부 + d.ts.
const RESOLVE_EXTS = [...SUPPORTED_EXTS, ".d.ts"];

// 증분용 — 최근 1개 root의 파일 추출 캐시(mtime+specs). 재분석 시 안 바뀐 파일은 재파싱 스킵.
// 증분 이득은 "같은 root 반복 분석"에만 나므로 현재 root만 보관(무한 증가 방지).
let lastCache: { root: string; cache: FileCache } | null = null;

// tsconfig의 paths 별칭(@/* 등) + baseUrl 로드. 없으면 빈 별칭.
function loadAliases(root: string): { baseUrl: string; paths: Record<string, string[]> } {
  try {
    const read = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
    const co = (read.config?.compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
    const baseUrl = co.baseUrl ? resolve(root, co.baseUrl) : root;
    return { baseUrl, paths: co.paths ?? {} };
  } catch {
    return { baseUrl: root, paths: {} };
  }
}

// 레포 루트 기준 상대경로(POSIX)로 정규화.
function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

export function buildRepoGraph(root: string): RepoGraph {
  const { files, capped } = scanRepo(root);
  const fileSet = new Set(files);
  const { baseUrl, paths } = loadAliases(root);

  // 확장자 없는 절대경로 후보 → 실제 존재하는 레포 파일(rel) 반환. 없으면 null.
  const matchFile = (absNoExt: string): string | null => {
    const candidates: string[] = [];
    const rel0 = toRel(root, absNoExt);
    candidates.push(rel0); // 이미 확장자 포함일 수도
    for (const e of RESOLVE_EXTS) candidates.push(rel0 + e);
    for (const e of RESOLVE_EXTS) candidates.push(`${rel0}/index${e}`);
    candidates.push(`${rel0}/__init__.py`); // Python 패키지 디렉터리
    candidates.push(`${rel0}/mod.rs`);      // Rust 모듈 디렉터리
    for (const c of candidates) if (fileSet.has(c)) return c;
    return null;
  };

  // 비상대 모듈 지정자 해석용 인덱스: 마지막 경로조각 → 확장자 뗀 후보들.
  const relNoExt = (rel: string) => rel.replace(/\.[^./]+$/, "");
  const byTail = new Map<string, { noExt: string; rel: string }[]>();
  for (const f of files) {
    const noExt = relNoExt(f);
    const tail = noExt.split("/").pop() ?? noExt;
    const arr = byTail.get(tail);
    if (arr) arr.push({ noExt, rel: f });
    else byTail.set(tail, [{ noExt, rel: f }]);
  }
  // 모듈 지정자(예: "a/b/c") → 경로가 그걸로 끝나는 레포 파일. 여러 언어 공통 best-effort.
  const resolveModule = (spec: string): string | null => {
    const clean = spec.replace(/^\/+|\/+$/g, "");
    if (!clean) return null;
    const tail = clean.split("/").pop() ?? clean;
    for (const c of byTail.get(tail) ?? []) {
      if (c.noExt === clean || c.noExt.endsWith("/" + clean)) return c.rel;
    }
    return null;
  };

  // import 지정자 → 레포 파일(rel) 또는 null(외부·미해결).
  const resolveSpec = (spec: string, fromAbs: string): string | null => {
    if (spec.startsWith("./") || spec.startsWith("../")) {
      return matchFile(resolve(dirname(fromAbs), spec));
    }
    // tsconfig paths 별칭 매칭(예: "@/*": ["./src/*"]).
    for (const [pattern, targets] of Object.entries(paths)) {
      const star = pattern.indexOf("*");
      if (star < 0) {
        if (spec === pattern && targets[0]) {
          const hit = matchFile(resolve(baseUrl, targets[0].replace("*", "")));
          if (hit) return hit;
        }
        continue;
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (spec.startsWith(prefix) && spec.endsWith(suffix)) {
        const mid = spec.slice(prefix.length, spec.length - suffix.length || undefined);
        for (const tgt of targets) {
          const hit = matchFile(resolve(baseUrl, tgt.replace("*", mid)));
          if (hit) return hit;
        }
      }
    }
    return resolveModule(spec); // 비상대 모듈(py/go 등) 접미사 매칭, 미해결이면 null(외부)
  };

  const nodes: RepoNode[] = files.map((f) => ({
    id: f,
    label: f.split("/").pop() ?? f,
    file: f,
    kind: "file",
    group: f.includes("/") ? f.split("/")[0] : "(root)",
  }));

  // 각 파일 mtime 확인(read보다 쌈) — 증분 재조정 입력.
  const statted: { rel: string; mtimeMs: number }[] = [];
  for (const f of files) {
    try { statted.push({ rel: f, mtimeMs: statSync(join(root, f)).mtimeMs }); } catch { /* 사라짐 등 스킵 */ }
  }

  // 변경/신규 파일만 read+extract(reconcile이 mtime 비교로 콜백 호출). 나머지 specs 재사용.
  const prev: FileCache = lastCache?.root === root ? lastCache.cache : new Map();
  const extract = (rel: string): string[] => {
    const lang = detectLang(rel);
    if (!lang) return [];
    try { return lang.extract(readFileSync(join(root, rel), "utf8")); } catch { return []; }
  };
  const { cache, reparsed } = reconcile(prev, statted, extract);
  lastCache = { root, cache };

  const edges: RepoEdge[] = [];
  const seen = new Set<string>();
  for (const [f, entry] of cache) {
    const abs = join(root, f);
    for (const spec of entry.specs) {
      const target = resolveSpec(spec, abs);
      if (!target || target === f) continue;
      const key = `${f}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: f, target, relation: "imports" });
    }
  }

  // 커뮤니티 검출(Louvain) — 실제 연결 촘촘한 논리 덩어리. 각 노드에 community 부여.
  const { communities, nodeCommunity } = detectCommunities({ root, nodes, edges, stats: { files: 0, edges: 0, scanned: 0, capped } });
  for (const n of nodes) n.community = nodeCommunity.get(n.id);

  return {
    root,
    nodes,
    edges,
    stats: { files: nodes.length, edges: edges.length, scanned: files.length, capped, reparsed },
    communities,
  };
}
