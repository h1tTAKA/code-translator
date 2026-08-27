// 코드 그래프 저장·freshness(#842 서브2) — 서버(Node) 전용. graph.json을 레포별 중앙 캐시에 저장.
// fingerprint(스캔 파일 mtime 해시)로 변경 감지 → 안 바뀌면 캐시 재사용(빌드 스킵). 레포에 파일 안 남김(중앙 캐시).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scanRepo } from "./scan";
import type { RepoGraph } from "./types";

const CACHE_DIR = join(homedir(), ".nunopi", "codegraph");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
function cachePath(root: string): string { return join(CACHE_DIR, `${sha(root)}.json`); }

// 레포 지문 — 스캔 대상 파일들의 "rel:mtime" 정렬 해시. 파싱 없이 빠름(readdir+stat). 어떤 파일이라도 바뀌면 달라짐.
export function fingerprintRepo(root: string): string {
  const { files } = scanRepo(root);
  const parts: string[] = [];
  for (const rel of files) {
    let mt = 0;
    try { mt = statSync(join(root, rel)).mtimeMs; } catch { /* 삭제 레이스 — 0 */ }
    parts.push(`${rel}:${mt}`);
  }
  parts.sort();
  return sha(parts.join("\n"));
}

interface Cached { fingerprint: string; builtAt: number; graph: RepoGraph }

/** 캐시된 그래프 로드(없거나 손상이면 null). */
export function readCachedGraph(root: string): Cached | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(root), "utf8")) as Cached;
    // RepoGraph는 nodes/edges 배열이 JSON. 그대로 사용.
    if (c && typeof c.fingerprint === "string" && c.graph) return c;
    return null;
  } catch { return null; }
}

/** 그래프+지문 저장(중앙 캐시). builtAt=저장 시각(호출부가 stamp — Date.now 금지 환경 대비 인자). */
export function writeCachedGraph(root: string, fingerprint: string, graph: RepoGraph, builtAt: number): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(root), JSON.stringify({ fingerprint, builtAt, graph } satisfies Cached));
  } catch { /* 캐시 실패는 치명적 아님 — 다음 빌드서 재시도 */ }
}
