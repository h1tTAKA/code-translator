// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 학습 스트림에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { snaClaudeProvider, snaCodexProvider, type AgentAnalyzeRequest } from "@/lib/agent";
import { emitNarration } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function narrationPrompt(agent: string, delta: string, diff: string): string {
  const hasDiff = diff.trim().length > 0;
  const task = hasDiff
    ? `위 **git diff가 방금까지 바뀐 진짜 코드**야. 이 diff를 중심으로 가르쳐:
- **무슨 코드가 어떻게 바뀌었나**: +/- 줄을 짚어 before→after로. 어떤 함수·변수·로직이 추가/수정/삭제됐고 그게 무슨 일을 하는지 코드 자체로.
- **왜/개념**: 그 코드가 왜 그렇게 동작하는지, 얽힌 프로그래밍·아키텍처 개념·패턴·원리.
- **용어**: 나온 함수·문법·라이브러리·개념을 "- **이름** — 쉬운 뜻" 목록으로.`
    : `아직 코드 변경(diff)은 없어. 에이전트가 무슨 파일/영역을 왜 보는지, 그 파일·함수가 코드베이스에서 무슨 역할인지, 얽힌 개념을 가르쳐. **제품 기능·UX 동작 서술(버튼 누르면 어디 가고 등) 금지 — 코드·구조·개념만.** 코드/구조 얘깃거리 없고 제품·상황 얘기뿐이면 딱 "SKIP"만.`;
  const material = hasDiff
    ? `## 실제 코드 변경 (git diff HEAD — 핵심 재료)
\`\`\`diff
${diff}
\`\`\`

## 터미널 로그 (보조 맥락)
${delta}`
    : `## 터미널 로그
${delta}`;

  return `너는 유저의 코드베이스를 가르치는 **선생님**이야. 유저가 에이전틱 코딩(${agent})하며 놓치는 **"이 코드가 뭐고 어떻게 동작하는지, 얽힌 프로그래밍·아키텍처 개념"**을 가르쳐줘.

📏 길이: 소제목 2~3개, 각 2~4문장, 전체 400~700자로 **완결**(시작한 소제목·문장 반드시 끝맺기).

⚠️ 절대 금지: 세션 중계(유저 지시 "~라고 하자", 에이전트 감정·의도 "혼났다/판단했다/보고했다", 사람 이름). 제품 기능·UX 동작 서술. 추측·일반론(릴리스 절차 등). → 오직 코드·구조·개념 지식 전달.

${task}

맨 앞 줄: 아주 짧은 제목(코드/개념 중심 명사구 25자 안팎). "제목:" 라벨·#·** 금지. JSON·코드블록으로 용어 출력 금지.

${material}`;
}

// 모델이 그래도 끝에 JSON terms 배열을 붙이면 파싱해 읽기 좋은 목록으로 교체(백스톱).
// 정규식 백트래킹 회피 — 마지막 '['부터 끝까지를 JSON.parse로 직접 시도(문자열 파싱이라 안전).
function cleanNote(s: string): string {
  // 잘림 백스톱: 끝에 본문 없이 소제목(## …)만 남으면(출력 truncate) 그 dangling 소제목 제거.
  let t = s.trim().replace(/\n#{1,6}\s+[^\n]*$/, "").trim();
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
  let body: { cwd?: unknown; agent?: unknown; delta?: unknown; diff?: unknown; providerId?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const agent = typeof body.agent === "string" && body.agent ? body.agent : "agent";
  const delta = typeof body.delta === "string" ? body.delta.slice(0, 6000) : "";
  const diff = typeof body.diff === "string" ? body.diff.slice(0, 6500) : "";
  if (!cwd || delta.trim().length < 40) return Response.json({ ok: false, reason: "no cwd/delta" });

  const useCodex = body.providerId === "codex";
  const provider = useCodex ? snaCodexProvider : snaClaudeProvider;
  const request: AgentAnalyzeRequest = {
    code: "repo terminal activity",
    locale: "ko",
    providerId: useCodex ? "codex-agent" : "claude-agent",
    mode: "chat",
    messages: [{ role: "user", content: narrationPrompt(agent, delta, diff) }],
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
