import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 브랜치 챗 컨텍스트(#653) — 그 브랜치가 "무슨 작업인지" 최소·정확 재료.
//   최근 커밋 제목 30개 + 기본브랜치 대비 변경파일 요약(--stat). 브랜치 전체 diff는 너무 큼(토큰).
// execFile(인자 배열, shell 미경유)로 인젝션 차단. 브랜치명은 형식 검증 + 선행 '-'(옵션 오해석) 차단.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

// git ref 이름 안전 문자만(영숫자 . _ / -). 선행 '-'는 옵션으로 오해석되니 별도 차단.
const isRef = (b: string) => /^[A-Za-z0-9._/-]+$/.test(b) && !b.startsWith("-") && !b.includes("..");

async function detectBase(opts: { cwd: string }): Promise<string> {
  // 원격 기본브랜치(origin/HEAD) 우선, 없으면 main/master 폴백.
  try {
    const s = (await pexecFile("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], opts)).stdout.trim();
    if (s) return s;
  } catch { /* ignore */ }
  for (const c of ["main", "master"]) {
    try { await pexecFile("git", ["rev-parse", "--verify", "--quiet", c], opts); return c; } catch { /* ignore */ }
  }
  return "";
}

export async function POST(request: Request): Promise<Response> {
  let path: unknown, branch: unknown;
  try { ({ path, branch } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (typeof branch !== "string" || !isRef(branch)) return Response.json({ error: "bad branch" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const opts = { cwd: path, maxBuffer: 10_000_000, timeout: 8000 } as const;
    const commits = (await pexecFile("git", ["log", branch, "-n", "30", "--no-color", "--pretty=format:%h %s"], opts)).stdout.trim();
    const base = await detectBase(opts);
    let stat = "";
    if (base && base !== branch) {
      try { stat = (await pexecFile("git", ["diff", "--stat", `${base}...${branch}`], opts)).stdout.trim(); } catch { /* ignore */ }
    }
    return Response.json({ ok: true, isGit: true, branch, base, commits, stat });
  } catch (e) {
    // 브랜치 없음 등 git 오류는 진짜 실패로 500(비-git 폴더는 애초에 그래프서 안 뜸).
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
