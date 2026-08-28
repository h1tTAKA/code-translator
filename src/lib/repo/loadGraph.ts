// 그래프 로드 공용(#853) — 캐시 신선하면 재사용, 아니면 빌드 후 저장. 라우트·MCP 툴 공용.
// (기존 라우트들의 scan→fingerprint→cache→build 5줄을 한곳으로. 순환 회피 위해 별도 파일.)
import { scanRepo } from "./scan";
import { buildRepoGraph } from "./graph";
import { fingerprintFromScan, readCachedGraph, writeCachedGraph } from "./graphStore";
import type { RepoGraph } from "./types";

export async function loadOrBuildGraph(root: string): Promise<{ graph: RepoGraph; fingerprint: string; cached: boolean }> {
  const scan = scanRepo(root);
  const fingerprint = fingerprintFromScan(root, scan.files);
  const hit = readCachedGraph(root);
  if (hit?.fingerprint === fingerprint) return { graph: hit.graph, fingerprint, cached: true };
  const graph = await buildRepoGraph(root, scan);
  writeCachedGraph(root, fingerprint, graph, Date.now());
  return { graph, fingerprint, cached: false };
}

// 빌드 없이 현재 지문만(freshness 체크용).
export function currentFingerprint(root: string): string {
  const scan = scanRepo(root);
  return fingerprintFromScan(root, scan.files);
}
