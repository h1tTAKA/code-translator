// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string): string {
  return `너는 옆에서 지켜보는 **관찰자·해설자**야. 터미널에서 AI 코딩 에이전트(${agent})가 하는 작업을, 손 놓고 지켜보는 유저에게 제3자 시점으로 해설해줘. 유저가 "아, 에이전트가 그래서 이렇게 했구나" 하고 이해하게.

⚠️ 절대 규칙:
- **너는 그 작업을 하는 사람이 아니다.** "제가 ~할게요", "~하겠습니다", "진행할게요", "알려주세요" 같은 1인칭·행위자 말투 금지. 항상 주어는 "에이전트"다: "에이전트가 ~하고 있어요 / ~했어요".
- **설명 대상은 에이전트의 실제 행동뿐이다.** 유저가 터미널에 친 지시("릴리스 ㄱㄱ" 등)나 에이전트의 계획·잡담을 해설하지 마("~의 의미" 금지). 에이전트가 **실제로 코드를 읽고/고치고/명령을 실행한** 구체적 행동만.
- **추측·일반론 금지.** 앞으로 뭘 할지 추측하거나, 일반 절차(릴리스 순서, 버저닝 관례 등)를 표·목록으로 나열하지 마. 로그에 실제로 실행된 것만.
- **실제 코드/파일 변경이나 구체적 명령 실행이 로그에 없고 유저 지시·계획·잡담뿐이면, 다른 말 없이 딱 "SKIP"만 출력.**
- 단순 중계("파일을 보고 있어요")로 끝내지 말고 아래를 짚어줘:

- **왜 이걸 하나**: 에이전트가 왜 이 파일/함수/로직을 찾아보거나 건드리는지(무슨 문제·맥락).
- **무엇을 어떻게**: 어떤 함수·메소드·로직을 어떻게 바꿨는지 — 추가/수정/삭제한 코드가 무슨 역할이고 before→after로 뭐가 달라지는지 구체적으로.
- **왜 그렇게**: 그 방식을 택한 이유(로그에서 읽히면).
- **용어**: 초보가 모를 개념·함수·문법 1~2개를 "- **이름** — 쉬운 뜻" 마크다운으로.

맨 앞 줄에는 **아주 짧은 제목**(핵심 명사구, 25자 안팎. 예: "삭제 확인 e2e 테스트 추가"). 완결 문장·긴 설명 금지. "제목:" 라벨이나 #·** 마크다운도 금지. 그다음 줄부터 위 항목들을 자세히.

⚠️ 로그가 스피너·진행표시·상태줄뿐이고 실제 코드/명령/탐색 활동이 없으면, 다른 말 없이 딱 "SKIP"만 출력. JSON·코드블록으로 용어 출력 금지.

활동 로그:
${delta}`;
}

// 모델이 그래도 끝에 JSON terms 배열을 붙이면 파싱해 읽기 좋은 목록으로 교체(백스톱).
// 정규식 백트래킹 회피 — 마지막 '['부터 끝까지를 JSON.parse로 직접 시도(문자열 파싱이라 안전).
function cleanNote(s: string): string {
  const t = s.trim();
  const idx = t.lastIndexOf("[");
  if (idx >= 0) {
    const tail = t.slice(idx);
    if (/^\[\s*\{/.test(tail) && tail.includes('"term"')) {
      try {
        const arr = JSON.parse(tail) as Array<{ term?: string; definition?: string }>;
        if (Array.isArray(arr)) {
          const list = arr.filter((x) => x && x.term).map((x) => `- **${x.term}** — ${x.definition ?? ""}`).join("\n");
          return (t.slice(0, idx).trim() + (list ? "\n\n" + list : "")).trim();
        }
      } catch { /* 파싱 실패 → 코드펜스 제거로 폴백 */ }
    }
  }
  return t.replace(/```(?:json)?[\s\S]*?```\s*$/, "").trim();
}

// summary → { title, note }. 첫 줄 = 제목(마크다운 heading·볼드·"제목:" 라벨 벗겨서), 나머지 = 본문.
function splitNarration(summary: string): { title: string; note: string } {
  const lines = summary.trim().split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  let title = (lines[i] || "").trim()
    .replace(/^#{1,6}\s*/, "")            // # heading
    .replace(/^\*\*(.*)\*\*$/, "$1")      // **볼드**
    .replace(/^(제목|타이틀|title)\s*[:：]\s*/i, "") // "제목:" 라벨
    .trim();
  if (title.length > 42) { const cut = title.slice(0, 42); const sp = cut.lastIndexOf(" "); title = (sp > 20 ? cut.slice(0, sp) : cut).trim() + "…"; } // 단어경계 자르기(mid-word 잘림 방지)
  const note = lines.slice(i + 1).join("\n").trim();
  return { title: title || "실시간 작업", note: note || title };
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
