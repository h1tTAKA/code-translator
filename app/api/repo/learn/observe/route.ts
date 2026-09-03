// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string): string {
  return `너는 초보 개발자 옆에서, 지금 터미널의 AI 코딩 에이전트(${agent})가 하는 작업을 실시간으로 중계·설명하는 조수야.
아래는 방금 그 에이전트가 한 활동(터미널 출력 일부)이야. 파일이 뭔지 소개만 하지 말고, **방금 무엇을 어떻게 했는지(특히 코드를 어떻게 고쳤는지)**에 집중해서 초보 눈높이로 간결하게 한국어로 설명해줘.

형식(반드시 지켜):
제목: (방금 한 행동 한 줄. 예: "App.tsx에 BookUser import 추가")
- 무엇을 왜: 방금 어떤 파일의 어느 부분을, 어떻게 바꿨는지(추가/수정/삭제 무엇인지 구체적으로). 코드를 고쳤으면 무슨 코드가 어떻게 달라졌는지. 명령을 돌렸으면 왜 돌렸고 결과가 어땠는지.
- 용어: (활동에 나온 개념·함수·라이브러리·문법 중 초보가 모를 만한 1~2개를 "이름 — 쉬운 뜻" 형식으로. 없으면 이 줄 생략.)

활동 로그:
${delta}`;
}

// summary → { title, note }. "제목:" 첫 줄을 행동 요약으로, 나머지를 설명으로.
function splitNarration(summary: string): { title: string; note: string } {
  const s = summary.trim();
  const m = s.match(/^제목\s*[:：]\s*(.+)$/m);
  if (m) {
    const title = m[1].trim().slice(0, 60);
    const note = s.replace(m[0], "").trim();
    return { title, note: note || title };
  }
  const firstLine = s.split("\n")[0]?.trim() ?? "";
  return { title: (firstLine.slice(0, 60) || "실시간 작업"), note: s };
}

export async function POST(req: Request): Promise<Response> {
  let body: { cwd?: unknown; agent?: unknown; delta?: unknown; providerId?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const agent = typeof body.agent === "string" && body.agent ? body.agent : "agent";
  const delta = typeof body.delta === "string" ? body.delta.slice(0, 6000) : "";
  if (!cwd || delta.trim().length < 40) return Response.json({ ok: false, reason: "no cwd/delta" });

  const useCodex = body.providerId === "codex";
  const provider = useCodex ? snaCodexProvider : snaClaudeProvider;
  const request: AgentAnalyzeRequest = {
    code: "repo terminal activity",
    locale: "ko",
    providerId: useCodex ? "codex-agent" : "claude-agent",
    mode: "chat",
    messages: [{ role: "user", content: narrationPrompt(agent, delta) }],
  };
  try {
    const res = await provider.analyze(request, { signal: req.signal });
    const summary = (res?.summary ?? "").trim();
    if (summary) { const { title, note } = splitNarration(summary); emitNarration(cwd, title, note, Date.now()); }
    return Response.json({ ok: true });
  } catch (e) {
    // 구독 미가용·레이트리밋 등 — 조용히 실패(다음 델타서 재시도). 사용자 흐름 안 막음.
    return Response.json({ ok: false, reason: String((e as Error)?.message || e) });
  }
}
