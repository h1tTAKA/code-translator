// 레포 그래프 빌더(#842 서브1) — 서버(Node) 전용. 흩어진 조각을 조립: scan(파일) + import 파싱(langs)
// + 심볼/호출 추출(symbols) → RepoGraph{nodes,edges}. 파싱은 전부 WASM tree-sitter(treesitter.ts, 네이티브 없음).
// 정확도 강화(scope-aware 해석·관계 확장)는 후속 커밋서 resolveCalls/추출 보강.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanRepo, type ScanResult } from "./scan";
import { detectLang } from "./langs";
import { extractSymbols, resolveCalls, type SymbolInfo, type RawCall } from "./symbols";
import type { RepoGraph, RepoNode, RepoEdge } from "./types";

// import 해석(상대 + tsconfig 별칭 + baseUrl)은 경량 모듈 imports.ts로 분리.
import { resolveImport, loadAliases } from "./imports";

// 파일명(경로 마지막) — 노드 label용.
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 레포 루트 → RepoGraph. 파일 노드 + import 엣지 + 심볼 노드 + contains + calls. */
export async function buildRepoGraph(root: string, pre?: ScanResult): Promise<RepoGraph> {
  const scan = pre ?? scanRepo(root); // 라우트가 이미 스캔했으면 재사용(이중 스캔 방지, #845 🟡)
  const fileSet = new Set(scan.files);
  const alias = loadAliases(root); // tsconfig paths(@/* 등) 별칭 해석 — Next 앱 엣지 확보

  const fileNodes: RepoNode[] = [];
  const symbolNodes: RepoNode[] = [];
  const edges: RepoEdge[] = [];
  const importEdges: RepoEdge[] = [];

  // 파일별 심볼(resolveCalls용)·원시호출·import 대상. 두 패스: (1) 추출 (2) 호출 해석(이웃 심볼 필요).
  const symbolsByFile = new Map<string, SymbolInfo[]>();
  const callsByFile = new Map<string, RawCall[]>();
  const heritageByFile = new Map<string, { classId: string; baseName: string; relation: "extends" | "implements" }[]>();
  const importTargetsByFile = new Map<string, string[]>(); // fromFile → 해석된 대상 파일들

  let reparsed = 0;
  for (const file of scan.files) {
    fileNodes.push({ id: file, label: baseName(file), file, kind: "file" });
    let text: string;
    try { text = readFileSync(join(root, file), "utf8"); } catch { continue; }

    // import 엣지(파일→파일). langs.extract가 지정자 목록 반환(TS compiler·Py·Go 등).
    const lang = detectLang(file);
    if (lang) {
      const targets: string[] = [];
      let specs: string[] = [];
      try { specs = lang.extract(text); } catch { specs = []; }
      for (const spec of specs) {
        const target = resolveImport(spec, file, fileSet, alias ?? undefined);
        if (target && target !== file) { importEdges.push({ source: file, target, relation: "imports" }); targets.push(target); }
      }
      importTargetsByFile.set(file, targets);
    }

    // 심볼 노드 + contains + 원시호출(tree-sitter). 미지원 언어면 빈 결과.
    const ex = await extractSymbols(text, file);
    if (ex.symbols.length) reparsed++;
    for (const n of ex.nodes) symbolNodes.push(n);
    for (const c of ex.contains) edges.push(c);
    symbolsByFile.set(file, ex.symbols);
    callsByFile.set(file, ex.calls);
    heritageByFile.set(file, ex.heritage);
  }

  // calls 해석(2패스) — 파일별 로컬 심볼 + import한 파일들의 심볼 테이블로 대상 매칭.
  for (const file of scan.files) {
    const calls = callsByFile.get(file);
    if (!calls || !calls.length) continue;
    const local = symbolsByFile.get(file) ?? [];
    const imported = new Map<string, SymbolInfo[]>();
    for (const t of importTargetsByFile.get(file) ?? []) imported.set(t, symbolsByFile.get(t) ?? []);
    for (const e of resolveCalls(calls, local, imported)) edges.push(e);
  }

  // 상속(extends/implements) 해석 — baseName을 로컬 class 심볼 → import한 파일의 class 심볼 순으로 매칭(#843).
  for (const file of scan.files) {
    const hs = heritageByFile.get(file);
    if (!hs || !hs.length) continue;
    const localClass = new Map<string, string>(); // 이름 → class 심볼 id(로컬)
    for (const s of symbolsByFile.get(file) ?? []) if (s.kind === "class" && !localClass.has(s.name)) localClass.set(s.name, s.id);
    const importClass = new Map<string, string>();
    for (const t of importTargetsByFile.get(file) ?? []) for (const s of symbolsByFile.get(t) ?? []) if (s.kind === "class" && !importClass.has(s.name)) importClass.set(s.name, s.id);
    const seen = new Set<string>();
    for (const h of hs) {
      const target = localClass.get(h.baseName) ?? importClass.get(h.baseName);
      if (!target || target === h.classId) continue;
      const key = `${h.classId}|${target}|${h.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: h.classId, target, relation: h.relation });
    }
  }

  const nodes = [...fileNodes, ...symbolNodes];
  const allEdges = [...importEdges, ...edges];
  return {
    root,
    nodes,
    edges: allEdges,
    stats: {
      files: fileNodes.length,
      edges: allEdges.length,
      scanned: scan.files.length,
      capped: scan.capped,
      reparsed,
    },
  };
}
