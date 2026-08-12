import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 레포의 git worktree 목록(#764) — 레포 탭 호버 카드에서 "어떤 워크트리가 도는가"를 보여준다.
// git worktree list --porcelain 파싱 + 워크트리별 dirty 수·ahead/behind(업스트림 있을 때). 서버 전용.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string | null; // 짧은 브랜치명(refs/heads/ 제거). detached면 null.
  head: string; // 짧은 sha(7)
  detached: boolean;
  bare: boolean;
  locked: boolean;
  dirty: number; // 커밋 전 변경 파일 수(0=clean)
  ahead: number; // 업스트림 대비 앞선 커밋 수
  behind: number; // 업스트림 대비 뒤진 커밋 수
}

// --porcelain 블록(빈 줄 구분): "worktree <path>" / "HEAD <sha>" / "branch <ref>" | "detached" / "bare" / "locked [reason]".
function parsePorcelain(out: string): Omit<WorktreeInfo, "dirty" | "ahead" | "behind">[] {
  const list: Omit<WorktreeInfo, "dirty" | "ahead" | "behind">[] = [];
  let cur: Partial<WorktreeInfo> | null = null;
  const flush = () => {
    if (cur?.path) list.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? "", detached: !!cur.detached, bare: !!cur.bare, locked: !!cur.locked });
    cur = null;
  };
  for (const line of out.split("\n")) {
    if (line === "") { flush(); continue; }
    if (line.startsWith("worktree ")) { cur = { path: line.slice("worktree ".length) }; }
    else if (!cur) { continue; }
    else if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length, "HEAD ".length + 7);
    else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
    else if (line.startsWith("locked")) cur.locked = true;
  }
  flush();
  return list;
}

export async function POST(request: Request): Promise<Response> {
  let path: unknown;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const opts = { cwd: path, maxBuffer: 10_000_000, timeout: 8000 } as const;
    const { stdout } = await pexecFile("git", ["worktree", "list", "--porcelain"], opts);
    const base = parsePorcelain(stdout);
    // 워크트리별 dirty·ahead/behind는 각 트리 cwd에서 조회(실패는 0으로 관대 처리).
    const worktrees: WorktreeInfo[] = await Promise.all(base.map(async (w) => {
      let dirty = 0, ahead = 0, behind = 0;
      if (!w.bare && existsSync(w.path)) {
        const o = { cwd: w.path, maxBuffer: 10_000_000, timeout: 8000 } as const;
        try { const s = (await pexecFile("git", ["status", "--porcelain", "-uall"], o)).stdout.trim(); dirty = s ? s.split("\n").length : 0; } catch { /* ignore */ }
        try {
          // @{u}...HEAD --count --left-right → "<behind>\t<ahead>". 업스트림 없으면 throw → 0.
          const lr = (await pexecFile("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"], o)).stdout.trim().split(/\s+/);
          behind = Number(lr[0]) || 0; ahead = Number(lr[1]) || 0;
        } catch { /* 업스트림 없음 */ }
      }
      return { ...w, dirty, ahead, behind };
    }));
    return Response.json({ ok: true, isGit: true, worktrees });
  } catch {
    return Response.json({ ok: true, isGit: false, worktrees: [] });
  }
}
