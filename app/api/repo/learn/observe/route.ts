// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string): string {
  return `너는 유저가 AI 코딩 에이전트(${agent})에게 일을 맡겨두고 손 놓고 지켜보는 동안, 그 에이전트가 "왜 이렇게 하는지"를 옆에서 대신 이해시켜 주는 학습 도우미야. 유저는 직접 코딩을 안 하니까 그냥 넘어가기 쉬운데, 네가 마치 유저가 직접 짜는 것처럼 사고 과정을 짚어줘야 해.

단순 중계("~파일을 보고 있습니다", "~하고 있습니다")는 금지. 아래 활동 로그에서 에이전트의 의도와 코드 변화를 읽어내서, 초보가 "아, 그래서 이렇게 했구나" 하게 한국어로 설명해:

- **왜 이걸 하나**: 에이전트가 왜 이 파일/함수/로직을 찾아보거나 건드리는지(무슨 문제를 풀려고, 무슨 맥락에서).
- **무엇을 어떻게**: 어떤 함수·메소드·로직을 어떻게 바꿨는지 — 추가/수정/삭제한 코드가 무슨 역할이고 before→after로 뭐가 달라지는지 구체적으로.
- **왜 그렇게**: 그 방식/접근을 택한 이유(있으면).
- **용어**: 초보가 모를 개념·함수·문법 1~2개를 "- **이름** — 쉬운 뜻" 마크다운으로.

맨 앞 줄은 "제목: (한 줄 핵심)".

⚠️ 만약 로그가 스피너·진행표시·상태줄뿐이고 실제 코드/명령/탐색 활동이 없으면, 다른 말 전혀 없이 딱 "SKIP" 한 단어만 출력해(무의미한 카드 방지). JSON·코드블록으로 용어 출력 금지.

활동 로그:
${delta}`;
}

// 모델이 그래도 끝에 JSON terms 배열을 붙이면 파싱해 읽기 좋은 목록으로 교체(백스톱). 실패 시 그 블록 제거.
function cleanNote(s: string): string {
  const m = s.match(/\[\s*\{[\s\S]*?"term"[\s\S]*\}\s*\]\s*$/);
  if (m && m.index !== undefined) {
    let list = "";
    try {
      const arr = JSON.parse(m[0]) as Array<{ term?: string; definition?: string }>;
      list = arr.filter((x) => x && x.term).map((x) => `- **${x.term}** — ${x.definition ?? ""}`).join("\n");
    } catch { /* 파싱 실패 → 블록만 제거 */ }
    return (s.slice(0, m.index).trim() + (list ? "\n\n" + list : "")).trim();
  }
  return s.replace(/```(?:json)?[\s\S]*?```\s*$/, "").trim();
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
    // 모델이 실제 활동 없다고 판단하면 "SKIP" → 카드 방출 안 함(무의미 내레이션·토큰 낭비 방지).
    if (summary && !/^SKIP\b/i.test(summary) && summary.length > 8) {
      const { title, note } = splitNarration(summary);
      emitNarration(cwd, title, cleanNote(note), Date.now());
    }
    return Response.json({ ok: true });
  } catch (e) {
    // 구독 미가용·레이트리밋 등 — 조용히 실패(다음 델타서 재시도). 사용자 흐름 안 막음.
    return Response.json({ ok: false, reason: String((e as Error)?.message || e) });
  }
}
