import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 워킹트리 diff(#660) — 커밋 전 변경(unstaged/staged/untracked)의 파일 diff. 서버 전용.
// execFile(인자 배열, shell 미경유) + `--` 앞세워 경로 인젝션/옵션 오해석 차단.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);
type Kind = "staged" | "unstaged" | "untracked";

export async function POST(request: Request): Promise<Response> {
  let path: unknown, file: unknown, kind: unknown;
  try { ({ path, file, kind } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (typeof file !== "string" || !file) return Response.json({ error: "file required" }, { status: 400 });
  if (kind !== "staged" && kind !== "unstaged" && kind !== "untracked") return Response.json({ error: "bad kind" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  const opts = { cwd: path, maxBuffer: 20_000_000, timeout: 8000 } as const;
  const k = kind as Kind;
  try {
    let diff: string;
    if (k === "untracked") {
      // 추적 안 하는 새 파일: /dev/null 대비. --no-index는 차이 있으면 exit 1 → stdout를 catch에서 회수.
      try {
        diff = (await pexecFile("git", ["diff", "--no-index", "-U100000", "--no-color", "--", "/dev/null", file], opts)).stdout;
      } catch (e) { diff = (e as { stdout?: string }).stdout ?? ""; }
    } else {
      const args = k === "staged"
        ? ["diff", "--cached", "-U100000", "--no-color", "--", file]
        : ["diff", "-U100000", "--no-color", "--", file];
      diff = (await pexecFile("git", args, opts)).stdout;
    }
    return Response.json({ ok: true, diff });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
