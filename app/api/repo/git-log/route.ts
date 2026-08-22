import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 워크스페이스 깃 그래프(#649) — 레포 cwd에서 git log 실행. 서버 전용(child_process).
// execFile(인자 배열, shell 미경유)로 인젝션 차단. 비-git 폴더면 isGit:false(에러 아님).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

// 필드=Unit Separator(%x1f), 커밋=Record Separator(%x1e). body(%b)가 여러 줄이라
// |·개행 구분은 파싱이 깨져 제어문자로 구분(커밋 메세지엔 실질적으로 안 나옴).
// %H해시 %P부모 %an작성자 %ae이메일 %at시각 %D장식 %s제목 %b본문. --all 전 브랜치(미머지 포함), --topo-order로 브랜치별 묶음.
// -n 한도 없음(#828): 전체 히스토리 → 머지 부모가 안 잘려 유령 레인 없음. (초대형 레포 대비 방어는 assignLanes에 유지 — 윈도우 밖 부모 레인 미할당.)
const ARGS = ["log", "--all", "--topo-order", "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e"];

export async function POST(request: Request): Promise<Response> {
  let path: unknown;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const opts = { cwd: path, maxBuffer: 64_000_000, timeout: 15000 } as const; // 무한도 히스토리(#828) — 대형 레포 출력·시간 여유(≈16만 커밋)
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
