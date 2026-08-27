// 기능 플로우 연결 근거화(#842 서브4) — 주어진 파일들 사이의 실측 연결(imports/calls)만 반환.
// 캐시 그래프 우선(freshness), 없거나 낡으면 빌드. 플로우 노드 파일 목록을 받아 소량 결과만(전체 그래프 미전송).
import { existsSync, statSync } from "node:fs";
import { scanRepo } from "@/lib/repo/scan";
import { buildRepoGraph } from "@/lib/repo/graph";
import { fingerprintFromScan, readCachedGraph, writeCachedGraph } from "@/lib/repo/graphStore";
import { connectionsAmong } from "@/lib/repo/flowConnect";

export async function POST(request: Request): Promise<Response> {
  let path: unknown, files: unknown;
  try { ({ path, files } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!Array.isArray(files) || !files.every((f) => typeof f === "string")) return Response.json({ error: "files must be string[]" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });

  try {
    const scan = scanRepo(path);
    const fingerprint = fingerprintFromScan(path, scan.files);
    let graph = readCachedGraph(path)?.fingerprint === fingerprint ? readCachedGraph(path)!.graph : null;
    if (!graph) { graph = await buildRepoGraph(path, scan); writeCachedGraph(path, fingerprint, graph, Date.now()); }
    const connections = connectionsAmong(graph, files as string[]);
    return Response.json({ ok: true, connections });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
