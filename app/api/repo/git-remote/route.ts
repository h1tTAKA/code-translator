import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 레포의 GitHub owner 추출(#777) — 레포 탭 아이콘을 그 조직/개인 프로필 아바타로 띄우기 위해.
// git remote get-url origin → github.com owner 파싱. 비GitHub·remote 없음·비git은 owner:null(폴백).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

// git@github.com:owner/repo.git · https://github.com/owner/repo(.git) · ssh://git@github.com/owner/repo
// 에서 owner를 뽑는다. github.com 아니면 null.
function parseOwner(remoteUrl: string): string | null {
  const m = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/[^/]+?(?:\.git)?\/?$/i);
  return m ? m[1] : null;
}

export async function POST(request: Request): Promise<Response> {
  let path: string;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ ok: true, owner: null });
  try {
    const opts = { cwd: path, maxBuffer: 1_000_000, timeout: 5000 } as const;
    const { stdout } = await pexecFile("git", ["remote", "get-url", "origin"], opts);
    return Response.json({ ok: true, owner: parseOwner(stdout) });
  } catch {
    // remote 없음·비git·에러 → 폴백(owner null).
    return Response.json({ ok: true, owner: null });
  }
}
