import { existsSync, statSync } from "node:fs";
import { scanAllFiles } from "@/lib/repo/scan";

// 워크스페이스 파일트리(#647) — 선택 폴더의 전체 파일 목록. 서버 전용(fs).
// 전체 파일(확장자 무관, 숨김파일 포함), 정크 폴더(node_modules·.git 등) 제외 + 상한. 트리화는 클라에서.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let path: unknown;
  try { ({ path } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const { files, capped } = scanAllFiles(path);
    return Response.json({ files, capped });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
