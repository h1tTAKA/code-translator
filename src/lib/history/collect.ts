import { getAllHistory } from "@/lib/historyDB";
import { loadAskStore } from "@/lib/askStore";
import { loadAllCardSessions } from "@/lib/cardChat";
import { loadTokenDetails, loadTermDetails, loadConceptDetails } from "@/lib/bookmarkDetails";
import { loadActivity } from "@/lib/srs/activityLog";
import { collectCards } from "@/lib/srs/collect";
import type { UnifiedHistoryEvent } from "./types";

// 첫 유저 메시지 요약(제목용). 없으면 폴백.
function firstQuestion(messages: { role: string; content: string }[], fallback: string): string {
  const q = messages.find((m) => m.role === "user")?.content?.trim();
  if (!q) return fallback;
  return q.length > 60 ? q.slice(0, 60) + "…" : q;
}

// 모든 저장소를 읽어 통일 히스토리 이벤트로(읽기 전용). 시간 내림차순 정렬.
// 출처별 try/catch — 하나가 실패해도 나머지는 수집.
export async function collectHistory(): Promise<UnifiedHistoryEvent[]> {
  const out: UnifiedHistoryEvent[] = [];

  // 1) 코드/글 분석 이력 + 그 안 챗룸
  try {
    const entries = await getAllHistory();
    for (const e of entries) {
      const mode = e.mode === "text" ? "text" : "code";
      const modeLabel = mode === "text" ? "글 분석" : "코드 분석";
      const aTitle = e.title || modeLabel;
      out.push({
        type: "analysis",
        id: e.id,
        createdAt: e.createdAt,
        title: aTitle,
        description: modeLabel,
        nav: { mode, sourceId: e.id },
      });
      for (const cs of e.chatSessions ?? []) {
        if (!cs.messages || cs.messages.length === 0) continue;
        out.push({
          type: "chat",
          id: cs.id,
          createdAt: e.createdAt, // 챗 세션 개별 시각 없어 분석 항목 시각으로 근사
          title: firstQuestion(cs.messages, "분석 챗"),
          description: `${modeLabel} '${aTitle}' 챗룸`,
          nav: { mode, sourceId: e.id, sessionId: cs.id },
        });
      }
    }
  } catch { /* ignore */ }

  // 2) 질문(질문모드) + 퀴즈
  try {
    const store = loadAskStore("");
    for (const s of store.sessions) {
      const sessLabel = `질문모드 '${s.title || "세션"}'`;
      for (const sub of s.subs) {
        if (sub.messages.length > 0) {
          out.push({
            type: "ask",
            id: sub.id,
            createdAt: sub.createdAt ?? s.createdAt,
            title: firstQuestion(sub.messages, "질문"),
            description: sessLabel,
            nav: { mode: "ask", sessionId: s.id, subId: sub.id },
          });
        }
        for (const qs of sub.quizzes ?? []) {
          out.push({
            type: "quiz",
            id: qs.id,
            createdAt: qs.createdAt,
            title: `퀴즈 ${qs.quiz.questions.length}문항`,
            description: sessLabel,
            nav: { mode: "ask", sessionId: s.id, subId: sub.id, quizId: qs.id },
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 3) 카드 챗룸. createdAt 없는 옛 세션은 그 카드의 북마크 시각으로 근사(now 금지 — 전부 '지금'처럼 보임).
  try {
    const cardTime = new Map<string, string>();
    for (const c of collectCards(["token", "concept", "term"], new Date())) {
      if (c.bookmarkedAt) cardTime.set(c.key, c.bookmarkedAt);
    }
    const all = loadAllCardSessions();
    for (const [cardKey, sessions] of Object.entries(all)) {
      for (const cs of sessions) {
        if (!cs.messages || cs.messages.length === 0) continue;
        out.push({
          type: "chat",
          id: cs.id,
          createdAt: cs.createdAt ?? cardTime.get(cardKey) ?? new Date().toISOString(),
          title: firstQuestion(cs.messages, "카드 챗"),
          description: `암기 카드 '${cardKey}' 챗룸`,
          nav: { mode: "memorize", cardKey },
        });
      }
    }
  } catch { /* ignore */ }

  // 4) 카드 생성(북마크) — 3개 맵. 키가 표시 텍스트.
  try {
    const maps = [loadTokenDetails(), loadTermDetails(), loadConceptDetails()];
    for (const map of maps) {
      for (const [text, d] of Object.entries(map)) {
        if (!d?.bookmarkedAt) continue;
        // 출처 경로: 어디서 이 카드를 저장했나.
        const from = d.sourceTitle
          ? `'${d.sourceTitle}'에서 저장`
          : d.sourceKind === "ask"
            ? "질문모드에서 저장"
            : d.sourceKind === "card"
              ? "암기 카드에서 저장"
              : d.sourceKind === "workspace"
                ? "워크스페이스 챗에서 저장"
                : "분석에서 저장";
        out.push({
          type: "bookmark",
          id: `bm-${text}-${d.bookmarkedAt}`,
          createdAt: d.bookmarkedAt,
          title: `카드 생성: ${text}`,
          description: from,
          // workspace 카드는 이동 대상(특정 챗 세션 복원)이 없어 비클릭(#750). 그 외만 nav 부여.
          ...(d.sourceKind === "workspace" ? {} : { nav: { mode: d.sourceKind === "ask" ? "ask" : "code", sourceId: d.sourceId, sessionId: d.sourceSessionId, subId: d.sourceSubId } as const }),
        });
      }
    }
  } catch { /* ignore */ }

  // 5) 플래시카드 복습 — 일별 집계(개별 시각 없어 그날 자정 기준).
  try {
    const activity = loadActivity();
    for (const [day, log] of Object.entries(activity)) {
      if (!log || log.n <= 0) continue;
      out.push({
        type: "review",
        id: `review-${day}`,
        createdAt: `${day}T00:00:00`, // 로컬 자정
        title: `복습 ${log.n}장`,
        nav: { mode: "memorize" },
      });
    }
  } catch { /* ignore */ }

  // 시간 내림차순(최신 위). ISO 사전식 비교.
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}
