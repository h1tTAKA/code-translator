import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 워킹트리 변경 파일(#660) — 커밋 전 변경(staged/unstaged/untracked) 목록 + ± 라인.
// git status --porcelain -z(파싱 안정·파일명 안전) + git diff --numstat(±) 병합. 서버 전용.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

// --numstat 출력("added\tdeleted\tpath\0") → path별 {added,deleted}. 바이너리는 "-" → 0.
function parseNumstat(z: string): Map<string, { added: number; deleted: number }> {
  const m = new Map<string, { added: number; deleted: number }>();
  for (const rec of z.split("\0")) {
    if (!rec.trim()) continue;
    const t = rec.split("\t");
    if (t.length < 3) continue;
    const added = t[0] === "-" ? 0 : Number(t[0]) || 0;
    const deleted = t[1] === "-" ? 0 : Number(t[1]) || 0;
    m.set(t[2], { added, deleted });
  }
  return m;
}

export async function POST(request: Request): Promise<Response> {
  let path: unknown;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const opts = { cwd: path, maxBuffer: 20_000_000, timeout: 8000 } as const;
    // -z: NUL 구분(파일명 공백/유니코드/따옴표 안전). 각 레코드 "XY path"(rename은 "XY new\0old").
    const { stdout } = await pexecFile("git", ["status", "--porcelain=v1", "-z", "-uall"], opts);
    const unstaged = parseNumstat((await pexecFile("git", ["diff", "--numstat", "-z"], opts)).stdout);
    const staged = parseNumstat((await pexecFile("git", ["diff", "--cached", "--numstat", "-z"], opts)).stdout);

    const files: { path: string; index: string; work: string; added: number; deleted: number }[] = [];
    const recs = stdout.split("\0");
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!rec) continue;
      const index = rec[0], work = rec[1];
      const p = rec.slice(3); // "XY " 다음이 경로(rename은 new 경로)
      if (index === "R" || index === "C") { i++; /* rename/copy: 다음 레코드가 old 경로, 스킵 */ }
      const ns = unstaged.get(p) ?? staged.get(p) ?? { added: 0, deleted: 0 };
      files.push({ path: p, index, work, added: ns.added, deleted: ns.deleted });
    }
    return Response.json({ ok: true, isGit: true, files });
  } catch {
    // 비-git 폴더 등 — 저장소 아님(앱 에러 아님).
    return Response.json({ ok: true, isGit: false, files: [] });
  }
}
