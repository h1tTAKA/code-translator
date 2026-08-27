// 코드 그래프 빌드·조회 API(#842 서브2) — 서버(Node) 전용. 활성 레포 → RepoGraph.
// freshness: 스캔 파일 mtime 지문이 캐시와 같으면 재빌드 없이 캐시 반환. force로 강제 재빌드.
// git-* 라우트 패턴(execFile no-shell 대신 여기선 tree-sitter 파싱은 라이브러리 내부).
import { existsSync, statSync } from "node:fs";
import { scanRepo } from "@/lib/repo/scan";
import { buildRepoGraph } from "@/lib/repo/graph";
import { fingerprintFromScan, readCachedGraph, writeCachedGraph } from "@/lib/repo/graphStore";

export async function POST(request: Request): Promise<Response> {
  let path: unknown, force: unknown;
  try { ({ path, force } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });

  try {
    const scan = scanRepo(path);                          // 1회 스캔 → fingerprint·build 공유(이중 스캔 방지 🟡)
    const fingerprint = fingerprintFromScan(path, scan.files);
    // 캐시 신선하면(지문 일치) 재빌드 스킵. force는 엄격히 true일 때만(문자열 "false" 등 오탐 방지 🔴).
    if (force !== true) {
      const cached = readCachedGraph(path);
      if (cached && cached.fingerprint === fingerprint) {
        return Response.json({ ok: true, cached: true, builtAt: cached.builtAt, graph: cached.graph });
      }
    }
    const graph = await buildRepoGraph(path, scan);
    const builtAt = Date.now();
    writeCachedGraph(path, fingerprint, graph, builtAt);
    return Response.json({ ok: true, cached: false, builtAt, graph });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
