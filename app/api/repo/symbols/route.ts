import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { extractSymbols, resolveCalls, type SymbolInfo } from "@/lib/repo/symbols";

// 파일 드릴다운(자식D) — 파일 1개의 심볼(함수/클래스) + 호출 엣지. 온디맨드(클릭 시).
// 호출 대상 해석용으로 그 파일이 import하는 파일들 심볼도 파싱(그래프가 이미 해석한 목록을 클라가 전달).
export const runtime = "nodejs";

const MAX_BYTES = 300_000;    // 초대형 파일 방어
const MAX_IMPORTS = 40;       // ponytail: import 심볼 파싱 상한(과도한 팬아웃 방지)

// 레포 루트 하위 파일만 읽기(경로 이탈 방지). 없거나 이탈이면 null.
function readRepoFile(rootAbs: string, rel: string): string | null {
  const target = resolve(rootAbs, rel);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null; // ../ 이탈 차단
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  const content = readFileSync(target, "utf8");
  return content.length > MAX_BYTES ? content.slice(0, MAX_BYTES) : content;
}

export async function POST(request: Request): Promise<Response> {
  let root: unknown, file: unknown, importedFiles: unknown;
  try {
    ({ root, file, importedFiles } = await request.json());
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof root !== "string" || typeof file !== "string" || !root || !file) {
    return Response.json({ error: "root and file required" }, { status: 400 });
  }
  const imports: string[] = Array.isArray(importedFiles)
    ? importedFiles.filter((f): f is string => typeof f === "string").slice(0, MAX_IMPORTS)
    : [];
  const rootAbs = resolve(root);

  try {
    const src = readRepoFile(rootAbs, file);
    if (src == null) return Response.json({ error: "not a file or escapes root" }, { status: 400 });

    const local = await extractSymbols(src, file);

    // import한 파일들 심볼 테이블(이름 해석용) — 심볼만 필요.
    const importedSymbols = new Map<string, SymbolInfo[]>();
    for (const imp of imports) {
      if (imp === file) continue;
      const isrc = readRepoFile(rootAbs, imp);
      if (isrc == null) continue;
      const r = await extractSymbols(isrc, imp);
      if (r.symbols.length) importedSymbols.set(imp, r.symbols);
    }

    const callEdges = resolveCalls(local.calls, local.symbols, importedSymbols);
    // cross-file 호출이 가리키는 import 심볼도 노드로 포함(그래야 그래프에 대상이 존재).
    const localIds = new Set(local.nodes.map((n) => n.id));
    const extraNodes = callEdges
      .filter((e) => !localIds.has(e.target))
      .map((e) => {
        for (const [imp, syms] of importedSymbols) { const s = syms.find((x) => x.id === e.target); if (s) return { id: s.id, label: s.name, file: imp, kind: s.kind }; }
        return null;
      })
      .filter((n): n is NonNullable<typeof n> => n != null);
    // 중복 제거(같은 import 심볼을 여러 호출이 가리킬 수 있음).
    const extraUniq = [...new Map(extraNodes.map((n) => [n.id, n])).values()];

    return Response.json({
      file,
      nodes: [...local.nodes, ...extraUniq],
      edges: [...local.contains, ...callEdges],
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
