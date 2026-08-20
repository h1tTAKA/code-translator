"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";
import { newAskId, type QuizSession, type AskQuiz } from "@/lib/askStore";
import QuizRunner from "@/components/ask/QuizRunner";

// 워크스페이스 챗 테스트 오버레이용 퀴즈 패널(#760) — 질문모드 AskSessionQuiz와 동일한 다중 세션 모델
// (여러 퀴즈 세션 + 새 퀴즈로 재출제 + 삭제). 실행부는 QuizRunner 재사용. 차이 두 가지:
//   ① 우측 aside/리사이즈 없이 오버레이 본문을 통째로 채우는 bare 레이아웃.
//   ② sourceContext(세션 대상 자료)를 QuizRunner에 넘겨 대화뿐 아니라 개념까지 출제.

const EMPTY_QUIZ: AskQuiz = { phase: "idle", questions: [], answers: {}, graded: {} };

export default function WorkspaceQuizPanel({ messages, sourceContext, providerId, providerSettings, quizzes, activeQuizId, onQuizzesChange }: {
  messages: ChatMessage[];
  sourceContext: string; // 대상 자료(레포/파일/diff/아키텍처)
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  quizzes: QuizSession[];
  activeQuizId?: string;
  onQuizzesChange: (quizzes: QuizSession[], activeQuizId: string | undefined) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const active = quizzes.find((q) => q.id === activeQuizId) ?? quizzes[quizzes.length - 1];
  // 초안(composing) = 옵션 고르는 새 퀴즈 화면. 아직 세션 아님(생성돼야 칩에 등록). 퀴즈 0개면 항상 초안.
  const [composing, setComposing] = useState(false);
  const showDraft = composing || quizzes.length === 0;
  // 초안 1회당 세션 1개만 만들도록 가드(생성 시 questions·phase 두 setState가 각각 콜백 부를 수 있음).
  const draftCommittedRef = useRef(false);
  useEffect(() => { if (showDraft) draftCommittedRef.current = false; }, [showDraft]);

  // ── 세션 조작 (AskSessionQuiz와 동일) ──────────────────
  function newDraft() { setComposing(true); }          // + 새 퀴즈 = 초안(옵션) 화면 열기 → 재출제
  function selectQuiz(id: string) { setComposing(false); onQuizzesChange(quizzes, id); }
  function onDraftChange(next: AskQuiz | undefined) {
    if (!next || next.questions.length === 0) return;
    if (draftCommittedRef.current) return;
    draftCommittedRef.current = true;
    const session: QuizSession = { id: newAskId(), createdAt: new Date().toISOString(), quiz: next };
    onQuizzesChange([...quizzes, session], session.id);
    setComposing(false);
  }
  function updateActiveQuiz(next: AskQuiz | undefined) {
    if (!active) return;
    const quiz = next ?? EMPTY_QUIZ;
    onQuizzesChange(quizzes.map((q) => (q.id === active.id ? { ...q, quiz } : q)), active.id);
  }
  async function deleteQuiz(id: string) {
    if (!(await confirm({ title: t("quiz.confirmDeleteTitle"), message: t("quiz.confirmDeleteMsg") }))) return;
    const remaining = quizzes.filter((q) => q.id !== id);
    const nextActive = id === active?.id ? remaining[remaining.length - 1]?.id : activeQuizId;
    onQuizzesChange(remaining, nextActive);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 세션 칩바 + 새 퀴즈 — 생성된 퀴즈가 있을 때만. 초안(생성 전)엔 이미 옵션 화면이라 새 퀴즈 버튼 숨김. */}
      {quizzes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {quizzes.map((s, i) => {
            const on = !showDraft && s.id === active?.id;
            return (
              <div key={s.id} className={`group flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[12px] transition ${
                on
                  ? "border-mustard-500 bg-mustard-500/10 text-mustard-600 dark:border-mustard-400 dark:bg-mustard-400/15 dark:text-mustard-400"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"
              }`}>
                <button type="button" onClick={() => selectQuiz(s.id)} className="cursor-pointer">{t("quiz.sessionN", { n: i + 1 })}</button>
                <button type="button" onClick={() => { void deleteQuiz(s.id); }} title={t("quiz.deleteQuiz")} aria-label={t("quiz.deleteQuiz")}
                  className="rounded-full p-0.5 text-zinc-400 opacity-60 transition hover:bg-rose-500/10 hover:text-rose-500 hover:opacity-100">
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
          {!showDraft && (
            <button type="button" onClick={newDraft} title={t("quiz.newQuiz")} aria-label={t("quiz.newQuiz")}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              <IconPlus size={13} stroke={2} aria-hidden />
              {t("quiz.newQuiz")}
            </button>
          )}
        </div>
      )}

      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {showDraft ? (
          // 초안: 빈 QuizRunner(옵션 화면). 생성 성공 시 onDraftChange가 세션으로 등록.
          <QuizRunner key="draft" messages={messages} sourceContext={sourceContext} providerId={providerId} providerSettings={providerSettings} quiz={undefined} onQuizChange={onDraftChange} />
        ) : active ? (
          <QuizRunner key={active.id} messages={messages} sourceContext={sourceContext} providerId={providerId} providerSettings={providerSettings} quiz={active.quiz} onQuizChange={updateActiveQuiz} />
        ) : null}
      </div>
    </div>
  );
}
