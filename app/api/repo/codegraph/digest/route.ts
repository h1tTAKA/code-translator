// 아키텍처 분석용 그래프 다이제스트(#842 서브3) — POST {path} → LLM 프롬프트용 압축 구조 요약.
// 서브2 캐시 그래프 재사용(없거나 낡으면 빌드). 전체 그래프 대신 수십 줄 요약만 반환(토큰 절약).
import { existsSync, statSync } from "node:fs";
import { scanRepo } from "@/lib/repo/scan";
import { buildRepoGraph } from "@/lib/repo/graph";
import { fingerprintFromScan, readCachedGraph, writeCachedGraph } from "@/lib/repo/graphStore";
import { graphDigest, type DigestOpts } from "@/lib/repo/graphDigest";

export async function POST(request: Request): Promise<Response> {
  let path: unknown, opts: unknown;
  try { ({ path, opts } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });

  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 }); // statSync throw → try 안
    const scan = scanRepo(path);
    const fingerprint = fingerprintFromScan(path, scan.files);
    const cached = readCachedGraph(path); // 1회만 읽기
    let graph = cached?.fingerprint === fingerprint ? cached.graph : null;
    if (!graph) { graph = await buildRepoGraph(path, scan); writeCachedGraph(path, fingerprint, graph, Date.now()); }
    const digest = graphDigest(graph, (opts && typeof opts === "object" ? opts : {}) as DigestOpts);
    return Response.json({ ok: true, digest });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
