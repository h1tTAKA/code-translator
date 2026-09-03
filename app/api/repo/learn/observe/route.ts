// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string): string {
  return `너는 유저의 코드베이스를 가르치는 **선생님**이야. 지금 터미널에서 AI 에이전트가 실제로 건드리는 파일·코드·명령을 재료 삼아, 유저가 에이전틱 코딩하며 그냥 넘어가서 놓치는 **"이 코드가 뭐고 어떻게 동작하는지, 얽힌 프로그래밍·아키텍처 개념"**을 풍부하고 구체적으로 가르쳐줘. 단답·요약 말고, 유저가 진짜 이해하게 충분히.

⚠️ 세션 중계 금지 (제일 중요):
- 터미널 CLI가 이미 에이전트의 행동을 보여주니, 그걸 똑같이 옮기는 건 무의미해. 유저 지시("~라고 하자"), 에이전트의 감정·의도·판단("혼났다", "인지하고", "스스로 복기했다", "완료라고 보고했다"), 사람 이름 언급 전부 금지.
- 상황을 중계하지 말고, **그 코드/개념이 뭔지**를 가르쳐. (상황 서술 ✗, 지식 전달 ✓)
- 추측·일반론(릴리스 절차 등 교과서 나열) 금지. 로그에 실제로 나온 파일·코드·명령만.

로그에 실제로 등장한 것을 바탕으로 아래를 자연스러운 마크다운 소제목으로 풍부하게 설명(내용에 맞는 섹션만, 억지로 빈 섹션 금지):
- **파일/영역**: 에이전트가 연·검색한 파일이나 영역이 이 코드베이스에서 무슨 역할을 하는지, 그 안 함수·로직이 실제로 무슨 일을 하는지.
- **코드 변경**(코드를 실제로 고쳤을 때만): 무슨 코드를 어떻게 바꿨는지 before→after로, 그게 왜 그렇게 동작하는지 코드 수준으로. ← 코드를 안 고치고 탐색·검증·빌드·실행만 했으면 이 섹션 넣지 말고, 무엇을 왜 확인하는지와 그 원리를 설명.
- **개념**: 얽힌 프로그래밍·아키텍처 개념·패턴·원리(예: overflow가 뭔지, IPC가 뭔지, 왜 이런 구조인지).
- **용어**: 나온 개념·함수·문법·라이브러리를 "- **이름** — 쉬운 뜻" 마크다운 목록으로.

맨 앞 줄: 아주 짧은 제목(파일/코드/개념 중심 명사구, 25자 안팎. 예: "모달 헤더 overflow와 렌더링 크기 측정"). 완결 문장·"제목:" 라벨·#·** 금지.

실제 파일·코드·명령 활동이 없고 계획·잡담·지시뿐이면 다른 말 없이 딱 "SKIP"만. JSON·코드블록으로 용어 출력 금지.

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
