import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 깃 그래프(#649) — 레포 cwd에서 git log 실행. 서버 전용(child_process).
// execFile(인자 배열, shell 미경유)로 인젝션 차단. 비-git 폴더면 isGit:false(에러 아님).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

// %H해시|%P부모들|%an작성자|%ae이메일|%at시각|%D장식(refs)|%s제목. --all로 전 브랜치, -n 200 상한.
const ARGS = ["log", "--all", "--date-order", "-n", "200", "--pretty=format:%H|%P|%an|%ae|%at|%D|%s"];

export async function POST(request: Request): Promise<Response> {
  let path: unknown;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const opts = { cwd: path, maxBuffer: 10_000_000, timeout: 8000 } as const;
    const { stdout } = await pexecFile("git", ARGS, opts);
    // 현재 브랜치(detached면 "HEAD"). 실패해도 로그는 반환.
    let branch = "";
    try { branch = (await pexecFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)).stdout.trim(); } catch { /* ignore */ }
    return Response.json({ ok: true, isGit: true, log: stdout, branch });
  } catch {
    // git 없음 / .git 아님 / 빈 레포 등 — 저장소 아님으로 처리(앱 에러 아님).
    return Response.json({ ok: true, isGit: false, log: "" });
  }
}
