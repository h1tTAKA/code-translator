"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconX, IconLoader2, IconInfinity, IconRefresh } from "@tabler/icons-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";
import type { QuizQuestion as QuizQ, QuizGraded as Graded, AskQuiz } from "@/lib/askStore";

// 퀴즈 한 세션의 실행부(생성→풀기→채점). 세션 전환 시 부모가 key로 리마운트해 활성 세션 데이터로 재초기화(#548).
// 에이전트 mode:"quiz" 1개로 생성(GENERATE)·채점(GRADE) 겸용. 출력은 ```json 블록, 클라가 파싱.

// 화면 단계 — 진행 중(loading/grading)·error 포함. 저장은 안정 단계(idle/solving/done)만.
type Phase = "idle" | "loading" | "solving" | "grading" | "done" | "error";

const LANG_NAME: Record<string, string> = { ko: "한국어", ja: "日本語", en: "English" };
// 누노피 브랜드 그라데이션(암기모드 막대와 동일) — 시안→블루→바이올렛.
const BRAND_GRADIENT = "linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)";

// 문제 수 범위 허용치 + 옵션 영속.
const COUNT_MIN = 2;
const COUNT_MAX = 20; // 실제 지정 가능한 최대 문제 수.
const UNLIMITED = COUNT_MAX + 1; // 슬라이더 최상단 = 무제한(∞). 20은 진짜 값, 21 위치가 ∞.
const QUIZ_OPTS_KEY = "nunopi.ask.quizOpts";
const DEFAULT_OPTS: QuizOpts = { min: 3, max: UNLIMITED, types: { mc: true, short: true } };

// 생성 옵션 — 문제 수 범위 + 허용 유형. idle 화면에서 유저가 정한다.
// 유형은 2종: mc(객관식) / short(주관식). 역질문은 short에 스타일로 흡수(#549).
interface QuizOpts {
  min: number;
  max: number;
  types: { mc: boolean; short: boolean };
}

const TYPE_DESC: Record<keyof QuizOpts["types"], string> = {
  mc: "mc(4지선다)",
  short: 'short(주관식, 한두 문장 서술) — 사실 확인뿐 아니라 "왜/어떻게 이렇게 했나" 이유·원리를 묻는 역질문 스타일도 섞어서',
};

// 저장된 옵션 방어 로드 — 이상하면 기본값. 범위·유형 클램프.
function loadOpts(): QuizOpts {
  try {
    const raw = JSON.parse(localStorage.getItem(QUIZ_OPTS_KEY) ?? "");
    if (!raw || typeof raw !== "object") return DEFAULT_OPTS;
    const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);
    let min = clamp(raw.min, COUNT_MIN, COUNT_MAX, DEFAULT_OPTS.min);
    let max = clamp(raw.max, COUNT_MIN, UNLIMITED, DEFAULT_OPTS.max);
    if (min > max) [min, max] = [max, min];
    const tr = raw.types && typeof raw.types === "object" ? raw.types : {};
    const types = { mc: tr.mc !== false, short: tr.short !== false };
    if (!types.mc && !types.short) return { min, max, types: DEFAULT_OPTS.types };
    return { min, max, types };
  } catch {
    return DEFAULT_OPTS;
  }
}

// 서브 대화(Q&A)를 퀴즈 생성 컨텍스트로 — 첫 줄 MODE로 프롬프트가 분기한다.
// source(선택): 세션 대상 자료(레포/파일/diff/아키텍처). 주면 대화 기억 + 자료 개념 둘 다에서 출제(#760). Ask는 안 줌.
function buildGenerateContext(messages: ChatMessage[], langName: string, opts: QuizOpts, source?: string): string {
  const qa = messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n\n");
  const allowed = (Object.keys(opts.types) as (keyof QuizOpts["types"])[]).filter((k) => opts.types[k]);
  const hasSource = !!source?.trim();
  const hasQa = messages.length > 0;
  const lines = [
    "MODE: GENERATE",
    `LANGUAGE: ${langName} (모든 문제·선택지·해설은 이 언어로)`,
    "",
    hasSource
      ? "아래 [대상 자료]는 학습자가 지금 보고 있는 코드/구조/변경/아키텍처이고, [학습자 Q&A]는 그가 실제로 물어본 것이다(있으면). 이 둘을 바탕으로 능동 회상용 퀴즈를 만든다."
      : "아래는 학습자가 실제로 물어본 질문과 받은 답이다. 이걸 바탕으로 능동 회상용 퀴즈를 만든다.",
    "규칙:",
    opts.max >= UNLIMITED
      ? `- 문제 ${opts.min}개 이상. 상한은 없다 — 재료가 풍부하면 그만큼 많이 내라. 재료가 적으면 ${opts.min}개보다 적게 내도 된다(억지로 채우지 말 것).`
      : `- 문제 ${opts.min}~${opts.max}개(목표 범위). 재료가 부족하면 그보다 적게 내도 된다(억지로 채우지 말 것).`,
    `- 다음 유형만 사용: ${allowed.map((k) => TYPE_DESC[k]).join(" / ")}. 지정 안 된 유형은 내지 말 것.`,
    hasSource
      ? "- 대상 자료의 핵심 개념·구조·이 코드를 이해하는 데 필요한 것, 그리고 학습자가 물어본 내용에서 출제. 자료·대화에 없는 걸 지어내지 말 것."
      : "- 학습자가 실제로 물어본 내용에서만 출제(모르는 걸 새로 묻지 않기).",
    '- type은 반드시 "mc" | "short" 중 하나 그대로(다른 표기 금지: "multiple_choice"/"reverse" X). 역질문도 type은 "short".',
    '- mc의 answer는 정답 옵션의 0-based 인덱스 숫자(0,1,2,3). 글자("A")나 정답 텍스트가 아니라 숫자.',
    "- 오직 ```json 펜스 블록 하나만 출력. 배열의 각 원소:",
    '  { "type": "mc", "q": "...", "options": ["A","B","C","D"], "answer": 정답인덱스(0-3), "why": "정답 이유 한 줄" }',
    '  { "type": "short", "q": "...", "answer": "모범답안", "why": "채점 포인트 한 줄" }',
  ];
  if (hasSource) lines.push("", "=== 대상 자료 ===", source!.trim());
  if (hasQa) lines.push("", "=== 학습자 Q&A ===", qa);
  return lines.join("\n");
}

// 주관식/역질문 채점 컨텍스트 — 문제·모범답안·학습자 답을 주고 항목별 판정을 받는다.
function buildGradeContext(items: { q: string; model: string; user: string }[], langName: string): string {
  const body = items
    .map((it, i) => `[${i}]\n문제: ${it.q}\n모범답안: ${it.model}\n학습자 답: ${it.user || "(무응답)"}`)
    .join("\n\n");
  return [
    "MODE: GRADE",
    `LANGUAGE: ${langName} (피드백은 이 언어로)`,
    "",
    "아래 각 항목에서 학습자 답이 모범답안의 핵심을 담았는지 판정한다. 표현이 달라도 요지가 맞으면 정답.",
    "오직 ```json 펜스 블록 하나만 출력. 배열 길이는 항목 수와 같고 순서 동일. 각 원소:",
    '  { "correct": true/false, "feedback": "짧고 따뜻한 교정 한두 문장" }',
    "",
    "=== 채점 항목 ===",
    body,
  ].join("\n");
}

// ```json ... ``` 안 JSON을 관대하게 파싱. 펜스 없으면 첫 [ ~ 마지막 ] 슬라이스.
function parseJsonBlock<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

// 모델이 흘리는 type 표기 흔들림 흡수 — "multiple_choice"·"subjective" 등도 우리 3종으로.
// 역질문(reverse*)은 이제 주관식(short)에 흡수 — 모델이 뱉거나 구버전 데이터도 short로(#549).
const TYPE_ALIASES: Record<string, QuizQ["type"]> = {
  mc: "mc", multiple_choice: "mc", "multiple-choice": "mc", multiplechoice: "mc", choice: "mc", objective: "mc",
  short: "short", short_answer: "short", shortanswer: "short", subjective: "short", written: "short",
  reverse: "short", reverse_question: "short", reversequestion: "short",
};

// mc 정답을 0-based 숫자 인덱스로 강제 — 숫자·글자("A")·정답텍스트 뭐가 와도 흡수. 범위 밖은 -1.
function coerceMcAnswer(a: unknown, options: string[]): number {
  let idx = -1;
  if (typeof a === "number" && Number.isInteger(a)) idx = a;
  else if (typeof a === "string") {
    const s = a.trim();
    if (/^[A-Za-z]$/.test(s)) idx = s.toUpperCase().charCodeAt(0) - 65;
    else if (/^\d+$/.test(s)) idx = parseInt(s, 10);
    else idx = options.findIndex((o) => o === s);
  }
  return idx >= 0 && idx < options.length ? idx : -1;
}

// LLM 원소 하나를 우리 QuizQ 모양으로 정규화(키·타입 흔들림 흡수). 못 살리면 null.
function normalizeQuestion(raw: unknown): QuizQ | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const q = typeof r.q === "string" ? r.q : typeof r.question === "string" ? r.question : "";
  if (!q.trim()) return null;
  const opts = Array.isArray(r.options) ? r.options.map((o) => String(o)) : [];
  const type = TYPE_ALIASES[String(r.type ?? "").toLowerCase()] ?? (opts.length ? "mc" : "short");
  const why = typeof r.why === "string" ? r.why : undefined;
  if (type === "mc") return { type, q, options: opts, answer: coerceMcAnswer(r.answer, opts), why };
  return { type, q, answer: typeof r.answer === "string" ? r.answer : String(r.answer ?? ""), why };
}

// 채점 결과 한 항목 정규화 — correct·feedback 흔들림 흡수. 못 살리면 null.
function coerceVerdict(raw: unknown): Graded | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c = r.correct;
  const correct = c === true || c === "true" || c === 1 || c === "1" || c === "correct" || c === "O";
  const wrong = c === false || c === "false" || c === 0 || c === "0" || c === "X";
  if (!correct && !wrong && typeof c !== "boolean") return null;
  const feedback = typeof r.feedback === "string" ? r.feedback : typeof r.comment === "string" ? r.comment : undefined;
  return { correct, feedback };
}

// mode:"quiz" 호출 — 스트리밍 result 이벤트의 summary(블록)를 모아 반환.
async function runQuiz(
  context: string,
  opts: { providerId: AgentProviderKind; providerSettings: ProviderSettings; locale: "ko" | "ja" | "en"; signal: AbortSignal },
): Promise<string> {
  const res = await fetch("/api/agent/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: opts.providerId,
      request: { code: context, locale: opts.locale, providerId: opts.providerId, mode: "quiz", providerSettings: opts.providerSettings },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  const take = (line: string) => {
    try {
      const ev = JSON.parse(line) as { type: string; response?: { summary: string } };
      if (ev.type === "result" && ev.response) out = ev.response.summary;
    } catch { /* 부분 청크 무시 */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) take(l);
  }
  if (buffer.trim()) take(buffer);
  return out;
}

// 퀴즈 한 세션 실행부. 활성 세션 데이터(quiz)로 초기화, 변경 시 onQuizChange로 그 세션에 저장.
export default function QuizRunner({ messages, providerId, providerSettings, quiz, onQuizChange, sourceContext }: {
  messages: ChatMessage[];
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  quiz?: AskQuiz;
  onQuizChange: (next: AskQuiz | undefined) => void;
  sourceContext?: string; // 세션 대상 자료(레포/파일/diff/아키텍처) — 있으면 대화 기억 + 자료 개념 둘 다 출제(#760)
}) {
  const t = useT();
  const { locale } = useLocale();
  const [phase, setPhase] = useState<Phase>(() => quiz?.phase ?? "idle");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQ[]>(() => quiz?.questions ?? []);
  const [answers, setAnswers] = useState<Record<number, number | string>>(() => quiz?.answers ?? {});
  const [graded, setGraded] = useState<Record<number, Graded>>(() => quiz?.graded ?? {});
  const [opts, setOpts] = useState<QuizOpts>(DEFAULT_OPTS);
  useEffect(() => { setOpts(loadOpts()); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  function updateOpts(next: QuizOpts) {
    setOpts(next);
    try { localStorage.setItem(QUIZ_OPTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  const anyType = opts.types.mc || opts.types.short;

  // 최신 저장 콜백을 ref로 — 부모 재렌더로 새 함수 와도 저장 effect 재실행 안 되게(커밋 후 갱신).
  const onQuizChangeRef = useRef(onQuizChange);
  useEffect(() => { onQuizChangeRef.current = onQuizChange; });

  // 상태 바뀌면 활성 세션에 저장. 진행 중(loading/grading)·error는 안정 단계로 눕혀 저장.
  useEffect(() => {
    if (questions.length === 0) { onQuizChangeRef.current(undefined); return; }
    const savedPhase: AskQuiz["phase"] = phase === "done" ? "done" : "solving";
    onQuizChangeRef.current({ phase: savedPhase, questions, answers, graded });
  }, [phase, questions, answers, graded]);

  // 진행 중 요청 — 재생성/언마운트 시 이전 요청을 끊어 언마운트 후 setState·낭비 요청을 막는다.
  const acRef = useRef<AbortController | null>(null);
  useEffect(() => () => acRef.current?.abort(), []);

  const langName = LANG_NAME[locale] ?? "English";
  // 재료 있음 = 대상 자료(sourceContext)가 있거나, 대화에 답변이 하나라도 있음(#760).
  const hasSource = !!sourceContext?.trim();
  const hasMaterial = hasSource || messages.some((m) => m.role === "assistant");

  async function generate() {
    setPhase("loading");
    setError(null);
    setAnswers({});
    setGraded({});
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const text = await runQuiz(buildGenerateContext(messages, langName, opts, sourceContext), { providerId, providerSettings, locale, signal: ac.signal });
      if (ac.signal.aborted) return;
      const parsed = parseJsonBlock<unknown[]>(text);
      const clean = (Array.isArray(parsed) ? parsed : []).map(normalizeQuestion).filter((q): q is QuizQ => q !== null);
      if (clean.length === 0) { setPhase("error"); setError(t("quiz.genFailed")); return; }
      setQuestions(clean);
      setPhase("solving");
    } catch {
      if (ac.signal.aborted) return;
      setPhase("error");
      setError(t("quiz.genFailed"));
    }
  }

  async function submit() {
    const next: Record<number, Graded> = {};
    const toGrade: { idx: number; q: string; model: string; user: string }[] = [];
    questions.forEach((q, i) => {
      if (q.type === "mc") {
        next[i] = { correct: answers[i] === q.answer };
      } else {
        toGrade.push({ idx: i, q: q.q, model: String(q.answer ?? ""), user: String(answers[i] ?? "") });
      }
    });
    if (toGrade.length === 0) { setGraded(next); setPhase("done"); return; }
    setPhase("grading");
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const text = await runQuiz(buildGradeContext(toGrade.map((x) => ({ q: x.q, model: x.model, user: x.user })), langName), { providerId, providerSettings, locale, signal: ac.signal });
      if (ac.signal.aborted) return;
      const verdicts = parseJsonBlock<Record<string, unknown>[]>(text) ?? [];
      toGrade.forEach((x, j) => {
        next[x.idx] = coerceVerdict(verdicts[j]) ?? { correct: false, feedback: t("quiz.gradeFailed") };
      });
      setGraded(next);
      setPhase("done");
    } catch {
      if (ac.signal.aborted) return;
      toGrade.forEach((x) => { next[x.idx] = { correct: false, feedback: t("quiz.gradeFailed") }; });
      setGraded(next);
      setPhase("done");
    }
  }

  const score = questions.reduce((n, _q, i) => n + (graded[i]?.correct ? 1 : 0), 0);
  const answeredAll = questions.every((q, i) => (q.type === "mc" ? typeof answers[i] === "number" : String(answers[i] ?? "").trim().length > 0));

  return (
    <>
      {phase === "idle" && (
        <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{hasMaterial ? (hasSource ? t("quiz.introSource") : t("quiz.intro")) : t("quiz.needMaterial")}</p>
          {hasMaterial && (
            <>
              <div className="w-full px-1 text-left">
                <div className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("quiz.optTypes")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(["mc", "short"] as const).map((k) => (
                    <label
                      key={k}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition ${
                        opts.types[k]
                          ? "border-[#3B34E2] bg-[#3B34E2]/10 text-[#3B34E2] dark:border-[#8b86f5] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]"
                          : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                      }`}
                    >
                      <input
                        type="checkbox" checked={opts.types[k]}
                        onChange={(e) => updateOpts({ ...opts, types: { ...opts.types, [k]: e.target.checked } })}
                        className="sr-only"
                      />
                      {t(`quiz.type.${k}`)}
                    </label>
                  ))}
                </div>
                {!anyType && <p className="mt-1.5 text-[11px] text-rose-500">{t("quiz.needType")}</p>}
              </div>

              <div className="w-full px-1 text-left">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  <span>{t("quiz.optCount")}</span>
                  <span className="flex items-center gap-0.5 text-[13px] font-semibold text-[#3B34E2] dark:text-[#8b86f5]">
                    {opts.min} ~ {opts.max >= UNLIMITED ? <IconInfinity size={20} stroke={2.2} aria-label={t("quiz.unlimited")} /> : opts.max}
                  </span>
                </div>
                <div className="relative h-5">
                  {/* 그라데이션은 트랙 전체 상시 + 선택 범위 밖만 흐리게. 시각용 div는 pointer-events-none. */}
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ backgroundImage: BRAND_GRADIENT }} />
                  <div className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-l-full bg-zinc-200/85 dark:bg-zinc-800/85" style={{ width: `${((opts.min - COUNT_MIN) / (UNLIMITED - COUNT_MIN)) * 100}%` }} />
                  <div className="pointer-events-none absolute right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-r-full bg-zinc-200/85 dark:bg-zinc-800/85" style={{ width: `${((UNLIMITED - opts.max) / (UNLIMITED - COUNT_MIN)) * 100}%` }} />
                  <input
                    type="range" min={COUNT_MIN} max={UNLIMITED} value={opts.min}
                    aria-label={t("quiz.optCountMin")}
                    onChange={(e) => updateOpts({ ...opts, min: Math.min(Number(e.target.value), opts.max, COUNT_MAX) })}
                    className="nunopi-range absolute inset-x-0 top-0 h-5 w-full"
                  />
                  <input
                    type="range" min={COUNT_MIN} max={UNLIMITED} value={opts.max}
                    aria-label={t("quiz.optCountMax")}
                    onChange={(e) => updateOpts({ ...opts, max: Math.max(Number(e.target.value), opts.min) })}
                    className="nunopi-range absolute inset-x-0 top-0 h-5 w-full"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">{t("quiz.optCountHint")}</p>
              </div>
            </>
          )}
          <button
            type="button"
            disabled={!hasMaterial || !anyType}
            onClick={() => { void generate(); }}
            className="rounded-lg bg-[#3B34E2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#322bc9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("quiz.make")}
          </button>
        </div>
      )}
      {(phase === "loading" || phase === "grading") && (
        <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          <IconLoader2 size={22} stroke={2} className="animate-spin" aria-hidden />
          {t(phase === "loading" ? "quiz.making" : "quiz.gradingNow")}
        </div>
      )}
      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
          <p className="text-[13px] text-rose-500">{error}</p>
          <button type="button" onClick={() => { void generate(); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[13px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {t("quiz.retry")}
          </button>
        </div>
      )}

      {(phase === "solving" || phase === "done" || phase === "grading") && questions.map((q, i) => {
        const g = graded[i];
        const showResult = phase === "done" && !!g;
        return (
          <div key={i} className="mb-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-1.5 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-[#3B34E2] dark:text-[#8b86f5]">{t(`quiz.type.${q.type}`)}</span>
              <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{q.q}</p>
              {showResult && (g.correct
                ? <IconCheck size={16} stroke={2.5} className="ml-auto shrink-0 text-emerald-500" aria-hidden />
                : <IconX size={16} stroke={2.5} className="ml-auto shrink-0 text-rose-500" aria-hidden />)}
            </div>

            {q.type === "mc" && q.options ? (
              <div className="flex flex-col gap-1">
                {q.options.map((opt, oi) => {
                  const picked = answers[i] === oi;
                  const isAnswer = showResult && oi === q.answer;      // 정답 보기
                  const wrongPick = showResult && picked && oi !== q.answer; // 내가 고른 오답
                  return (
                    <label key={oi} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px] transition ${
                      isAnswer ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30"
                      : wrongPick ? "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20"
                      : picked ? "border-[#3B34E2] bg-[#3B34E2]/5 dark:border-[#8b86f5]"
                      : "border-zinc-200 dark:border-zinc-800"} ${showResult ? "cursor-default" : "cursor-pointer"}`}>
                      {/* 채점 후엔 클릭 잠금(pointer-events-none)만 하고 disabled는 안 씀 — 고른 라디오 체크가 그대로 보이게. */}
                      <input
                        type="radio" name={`q${i}`} checked={picked}
                        onChange={() => { if (!showResult) setAnswers((a) => ({ ...a, [i]: oi })); }}
                        className={`${showResult ? "pointer-events-none" : ""} ${wrongPick ? "accent-rose-400" : isAnswer ? "accent-emerald-500" : "accent-[#3B34E2]"}`}
                      />
                      <span className="text-zinc-700 dark:text-zinc-200">{opt}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={String(answers[i] ?? "")}
                disabled={showResult}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                rows={2}
                placeholder={t("quiz.answerPlaceholder")}
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none focus:border-[#3B34E2] disabled:opacity-70 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              />
            )}

            {showResult && (
              <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2 text-[11px] dark:border-zinc-800">
                {q.type !== "mc" && (
                  <p className="text-zinc-500 dark:text-zinc-400"><span className="font-semibold">{t("quiz.modelAnswer")}:</span> {String(q.answer)}</p>
                )}
                {g.feedback && <p className="text-zinc-600 dark:text-zinc-300">{g.feedback}</p>}
                {q.why && <p className="text-zinc-400 dark:text-zinc-500">{q.why}</p>}
              </div>
            )}
          </div>
        );
      })}

      {phase === "solving" && questions.length > 0 && (
        <button
          type="button"
          disabled={!answeredAll}
          onClick={() => { void submit(); }}
          className="mt-1 w-full rounded-lg bg-[#3B34E2] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#2f28c4] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#8b86f5] dark:hover:bg-[#7a74e8]"
        >
          {t("quiz.submit")}
        </button>
      )}

      {phase === "done" && (
        <div className="mt-1 space-y-2">
          <div className="rounded-lg bg-[#3B34E2]/5 px-3 py-2.5 text-center text-[13px] font-semibold text-[#3B34E2] dark:bg-[#8b86f5]/10 dark:text-[#8b86f5]">
            {t("quiz.score")}: {score} / {questions.length}
          </div>
          {/* 같은 문제 다시 풀기 — 답·채점만 비우고 풀이로 복귀. */}
          <button
            type="button"
            onClick={() => { setAnswers({}); setGraded({}); setPhase("solving"); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-amber-600"
          >
            <IconRefresh size={15} stroke={2} aria-hidden />
            {t("quiz.retrySame")}
          </button>
        </div>
      )}
    </>
  );
}
