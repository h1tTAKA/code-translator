// 에이전트 MCP 연결(#853) — opt-in. 대상 에이전트 설정에 우리 코드그래프 브릿지 등록.
// GET: 감지 결과(어떤 에이전트 흔적 있나). POST {root, targets[], appUrl?}: 주입.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectAgents, connectAgents, type AgentTarget } from "@/lib/repo/mcp/register";

// 브릿지 스크립트 절대경로 — 앱 cwd 기준. (패키징 환경 경로는 후속 확인 #684 계열.)
function bridgePath(): string { return join(process.cwd(), "src", "lib", "repo", "mcp", "bridge.cjs"); }

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) return Response.json({ error: "root required" }, { status: 400 });
  return Response.json({ ok: true, agents: detectAgents(root), bridge: bridgePath() });
}

export async function POST(request: Request): Promise<Response> {
  let root: unknown, targets: unknown, appUrl: unknown;
  try { ({ root, targets, appUrl } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof root !== "string" || !root.trim()) return Response.json({ error: "root required" }, { status: 400 });
  const list = Array.isArray(targets) ? targets.filter((t): t is AgentTarget => t === "claude" || t === "codex") : [];
  if (!list.length) return Response.json({ error: "targets required (claude|codex)" }, { status: 400 });
  const url = typeof appUrl === "string" && appUrl.trim() ? appUrl.trim() : new URL(request.url).origin;
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
    const bp = bridgePath();
    if (!existsSync(bp)) return Response.json({ ok: false, error: `bridge not found: ${bp}` }, { status: 500 });
    const results = connectAgents(root, list, bp, url);
    return Response.json({ ok: true, results, bridge: bp, appUrl: url });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
