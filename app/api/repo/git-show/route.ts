import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 깃 diff(#649) — 커밋의 바뀐 파일 목록, 또는 특정 파일의 diff. 서버 전용.
// file 없으면 name-status(목록), 있으면 그 파일 diff. execFile(인자 배열, shell 미경유).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);
const isHash = (h: string) => /^[0-9a-fA-F]{4,40}$/.test(h);

export async function POST(request: Request): Promise<Response> {
  let path: unknown, hash: unknown, file: unknown;
  try { ({ path, hash, file } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (typeof hash !== "string" || !isHash(hash)) return Response.json({ error: "bad hash" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  const opts = { cwd: path, maxBuffer: 20_000_000, timeout: 8000 } as const;
  try {
    if (typeof file === "string" && file) {
      // 이 커밋에서 이 파일의 diff(첫 부모 대비). -U100000 = 전체 컨텍스트(생략 없이 파일 전체 표시).
      const { stdout } = await pexecFile("git", ["show", "--format=", "--no-color", "-U100000", hash, "--", file], opts);
      return Response.json({ ok: true, diff: stdout });
    }
    // 바뀐 파일 목록: "M\tpath" / "A\tpath" / "D\tpath" / "R100\told\tnew".
    const { stdout } = await pexecFile("git", ["show", "--name-status", "--format=", "--no-color", hash], opts);
    const files = stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split("\t");
      const status = parts[0][0]; // M/A/D/R/C
      const p = parts[parts.length - 1]; // R/C는 새 경로가 마지막
      return { status, path: p };
    });
    return Response.json({ ok: true, files });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 200 });
  }
}
