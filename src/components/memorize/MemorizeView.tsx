"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/ui/Toast";
import { askSourceExists } from "@/lib/askStore";
import DeckSelect from "./DeckSelect";
import CardSession from "./CardSession";
import { FlyCardProvider } from "./FlyCard";
import AllCardsModal from "./AllCardsModal";
import MemModal from "./MemModal";
import { type Card, type CardOrder, type Deck, type SrsSource } from "@/lib/srs/types";
import { loadCustomDecks, CUSTOM_DECKS_CHANGED_EVENT, type CustomDeck } from "@/lib/srs/customDeck";
import { type CardCategory } from "@/lib/srs/due";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

type MemPhase = "gallery" | "session";
type ReviewMode = "due" | "all";

// 암기 모드 최상위 뷰 — 카드 갤러리(랜딩) → 복습 암기(덱선택 모달) → 카드 세션(④). active: 암기 영역이 켜진 상태.
export default function MemorizeView({ active = true, providerId, providerSettings, sourceIds, onGoToSource, onGoToAskSource, goToCard }: { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; sourceIds: Set<string>; onGoToSource: (sourceId: string, sessionId?: string) => void; onGoToAskSource?: (sessionId: string, subId?: string) => void; goToCard?: { cardKey: string; nonce: number } }) {
  const t = useT();
  const toast = useToast();
  const [phase, setPhase] = useState<MemPhase>("gallery");
  // 복습 암기(덱선택) 모달 열림 — 세션 시작 후에도 유지해, 학습 끝/뒤로 시 이 모달이 떠 있던 화면으로 복귀.
  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [autoThrowKey, setAutoThrowKey] = useState<string | undefined>(undefined);
  const [autoThrowChat, setAutoThrowChat] = useState(false); // peek 시 챗룸 자동 열기(히스토리 카드챗 이동)

  // 카드 "출처로 이동" — 출처 종류별 분기. card=갤러리에서 생성처 카드 peek, ask=Ask로, analysis=코드/글로.
  function goToCardSource(card: Card) {
    if (card.sourceKind === "card" && card.originCardKey) {
      setPhase("gallery"); // 세션 중이면 갤러리로 나와 peek
      setAutoThrowKey(card.originCardKey);
      setAutoThrowChat(false); // 생성처 카드 peek — 챗 자동 열기 아님
    } else if (card.sourceKind === "ask" && card.sourceSessionId) {
      // 질문발 — 출처(세션/질문)가 남아 있을 때만 Ask로 전환·이동. 삭제됐으면 안내.
      if (askSourceExists(card.sourceSessionId, card.sourceSubId)) onGoToAskSource?.(card.sourceSessionId, card.sourceSubId);
      else toast(t("ask.sourceDeleted"), "error");
    } else if (card.sourceId) {
      // 분석발 — 다른 뷰(코드/글)로 전환만.
      onGoToSource(card.sourceId, card.sourceSessionId);
    }
  }
  const [session, setSession] = useState<{ deck: Deck; sources: SrsSource[]; mode: ReviewMode; resume: boolean; order: CardOrder; categories: CardCategory[]; cardKeys?: string[]; customDeckId?: string } | null>(null);
  // 선택된 커스텀 덱 id(null=고정 덱). DeckSelect가 controlled로 공유.
  const [customId, setCustomId] = useState<string | null>(null);
  const [customDecks, setCustomDecks] = useState<CustomDeck[]>([]);
  useEffect(() => {
    const load = () => setCustomDecks(loadCustomDecks());
    load();
    window.addEventListener(CUSTOM_DECKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CUSTOM_DECKS_CHANGED_EVENT, load);
  }, []);
  // 덱/세부출처 — DeckSelect controlled 소유. localStorage 영속.
  const [deck, setDeckRaw] = useState<Deck>(() => {
    if (typeof window === "undefined") return "code";
    const d = localStorage.getItem("nunopi:mem-deck");
    return d === "code" || d === "text" || d === "all" ? d : "code";
  });
  const [codeSources, setCodeSourcesRaw] = useState<Set<SrsSource>>(() => {
    if (typeof window === "undefined") return new Set(["token", "concept"]);
    try {
      const raw = localStorage.getItem("nunopi:mem-code-sources");
      const arr = raw ? (JSON.parse(raw) as SrsSource[]) : null;
      if (Array.isArray(arr)) return new Set(arr);
    } catch { /* ignore */ }
    return new Set(["token", "concept"]);
  });
  function setDeck(d: Deck) {
    setDeckRaw(d);
    setCustomId(null); // 고정 덱 선택 시 커스텀 선택 해제
    try { localStorage.setItem("nunopi:mem-deck", d); } catch { /* ignore */ }
  }
  function setCodeSources(s: Set<SrsSource>) {
    setCodeSourcesRaw(s);
    try { localStorage.setItem("nunopi:mem-code-sources", JSON.stringify([...s])); } catch { /* ignore */ }
  }
  // 커스텀 덱이 삭제되면 선택 해제.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (customId && !customDecks.some((d) => d.id === customId)) setCustomId(null);
  }, [customDecks, customId]);
  // 항상 마운트되지만 localStorage를 읽으므로 서버/첫 렌더에선 비운다(하이드레이션 불일치 방지).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const now = useState(() => new Date())[0];
  // 전역 히스토리 등에서 특정 카드로 이동 — 갤러리에서 그 카드를 peek(챗룸 접근점). nonce로 재트리거.
  useEffect(() => {
    if (!goToCard) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPhase("gallery");
    setAutoThrowKey(goToCard.cardKey);
    setAutoThrowChat(true); // 히스토리 카드챗 이동 — 챗룸 자동 열기
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToCard?.nonce]);
  if (!mounted) return null;

  function handleStart(deck: Deck, sources: SrsSource[], mode: ReviewMode, resume: boolean, order: CardOrder, categories: CardCategory[]) {
    setSession({ deck, sources, mode, resume, order, categories });
    setPhase("session"); // deckModalOpen은 유지 — 세션 끝나면 이 모달로 복귀.
  }

  // 커스텀 덱 시작 — cardKeys로 세션(sources 무관, deck placeholder "all"). customDeckId로 이어하기 키.
  function handleStartCustom(id: string, cardKeys: string[], mode: ReviewMode, order: CardOrder, categories: CardCategory[], resume: boolean) {
    setSession({ deck: "all", sources: [], mode, resume, order, categories, cardKeys, customDeckId: id });
    setPhase("session");
  }

  if (phase === "session" && session) {
    return <CardSession active={active} deck={session.deck} resume={session.resume} order={session.order} categories={session.categories} cardKeys={session.cardKeys} customDeckId={session.customDeckId} sources={session.sources} mode={session.mode} providerId={providerId} providerSettings={providerSettings} sourceIds={sourceIds} onGoToSource={goToCardSource} onExit={() => setPhase("gallery")} />;
  }

  // 갤러리 랜딩 — AllCardsModal을 인라인(asBase)으로. relative 컨테이너라 모달(absolute inset-0)이 갤러리를 덮는다.
  // FlyCardProvider로 감싸 갤러리 카드 던지기 연출 공유.
  return (
    <FlyCardProvider active={active} providerId={providerId} providerSettings={providerSettings} sourceIds={sourceIds} onGoToSource={goToCardSource}>
      <div className="relative h-full w-full">
        <AllCardsModal
          asBase
          now={now}
          active={active}
          autoThrowCardKey={autoThrowKey}
          autoThrowOpenChat={autoThrowChat}
          providerId={providerId}
          providerSettings={providerSettings}
          onOpenDeckReview={() => setDeckModalOpen(true)}
          onClose={() => { setAutoThrowKey(undefined); setAutoThrowChat(false); }}
        />
        {deckModalOpen && (
          <MemModal title={t("mem.reviewStudy")} onClose={() => setDeckModalOpen(false)} panelClassName="w-[min(94vw,560px)]">
            <DeckSelect
              deck={deck}
              onDeckChange={setDeck}
              codeSources={codeSources}
              onCodeSourcesChange={setCodeSources}
              selectedCustomId={customId}
              onSelectCustom={setCustomId}
              onStart={handleStart}
              onStartCustom={handleStartCustom}
            />
          </MemModal>
        )}
      </div>
    </FlyCardProvider>
  );
}
