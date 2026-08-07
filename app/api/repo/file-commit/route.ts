import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 워킹트리 챗 세션 커밋 승계(#689) — 그 파일이 baseHead 이후 커밋됐는지 조회.
// head=현재 HEAD sha. hash=baseHead..HEAD 범위서 그 파일 담은 최신 커밋(없으면 null=되돌림/미커밋).
// execFile(인자 배열, shell 미경유) + `--` 앞세워 경로 인젝션/옵션 오해석 차단. 서버 전용.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);
const SHA_RE = /^[0-9a-f]{7,40}$/i; // baseHead 형식 검증(인자 안전)

export async function POST(request: Request): Promise<Response> {
  let path: unknown, file: unknown, baseHead: unknown;
  try { ({ path, file, baseHead } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  const opts = { cwd: path, maxBuffer: 1_000_000, timeout: 8000 } as const;
  try {
    const head = (await pexecFile("git", ["rev-parse", "HEAD"], opts)).stdout.trim();
    let hash: string | null = null;
    // baseHead(유효 sha)와 file이 있고 HEAD가 그 사이 전진했으면, 그 파일 담은 범위 내 최신 커밋 조회.
    if (typeof file === "string" && file && typeof baseHead === "string" && SHA_RE.test(baseHead) && baseHead !== head) {
      try {
        const out = (await pexecFile("git", ["log", `${baseHead}..HEAD`, "-1", "--format=%H", "--", file], opts)).stdout.trim();
        if (out) hash = out;
      } catch { /* 범위/파일 없음 등 — hash null 유지 */ }
    }
    return Response.json({ ok: true, head, hash });
  } catch {
    // git 아님 / HEAD 없음(빈 레포) 등 — 승계 불가로 처리(앱 에러 아님).
    return Response.json({ ok: true, head: "", hash: null });
  }
}
