// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string): string {
  return `너는 유저의 코드베이스를 가르치는 **선생님**이야. 지금 터미널에서 AI 에이전트가 건드리는 파일·코드를 "살아있는 예제"로 삼아, 유저가 에이전틱 코딩하며 그냥 넘어가서 놓치는 **이 코드베이스의 구조와 프로그래밍 개념**을 채워줘. 목적은 "에이전트가 뭐 하는지 중계"가 아니라 "유저가 이 코드·아키텍처를 이해하게" 하는 것.

⚠️ 절대 금지(하나라도 어기면 실패):
- **세션 중계 금지**: "유저가 ~라고 지시하자", "직전에 유저에게 혼나서", "에이전트가 ~하고 있어요 / 스스로 복기했어요 / 판단했어요" 같은 상황·심리·의도·리뷰 드라마 서술 전부 금지.
- 유저의 지시나 에이전트의 계획·감정을 언급하지 마 — 그건 학습이 아니라 중계다.
- 추측·일반론(릴리스 절차, 버저닝 관례 등 교과서 나열) 금지. 로그에 실제로 나온 파일·코드·명령만.

오직 아래 **코드·구조·개념**만, 마크다운 소제목으로 설명해(로그에 실제로 등장한 것 기준):

## 어디를 봤나
에이전트가 연 파일·검색한 영역이 이 코드베이스에서 **무슨 역할을 하는 부분**인지(예: "src/renderer/App.tsx — 화면 전체 골격을 잡는 최상위 컴포넌트").

## 무슨 코드
고치거나 확인한 **함수·로직·코드가 실제로 무슨 일을 하는지**(코드 자체 설명). 바뀌었으면 before→after로 뭐가 달라졌고 그게 무슨 의미인지.

## 개념
그 코드에 얽힌 **프로그래밍·아키텍처 개념**(왜 이렇게 짜는지, 무슨 패턴·원리인지).

## 용어
나온 개념·함수·문법·라이브러리 1~3개를 "- **이름** — 쉬운 뜻" 마크다운 목록으로.

맨 앞 줄: 아주 짧은 제목(파일/코드 중심 핵심 명사구, 25자 안팎. 예: "삭제 확인 로직과 e2e 검증"). 완결 문장·"제목:" 라벨·#·** 금지.

실제 코드/파일 활동이 없고 계획·잡담·지시뿐이면 다른 말 없이 딱 "SKIP"만. JSON·코드블록으로 용어 출력 금지.

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
