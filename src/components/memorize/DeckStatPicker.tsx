"use client";

import { IconStack2, IconCode, IconFileText } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { type Deck, type SrsSource } from "@/lib/srs/types";
import { type CustomDeck } from "@/lib/srs/customDeck";

const FIXED: { deck: Deck; tKey: string; Icon: typeof IconCode }[] = [
  { deck: "all", tKey: "mem.deckAll", Icon: IconStack2 },
  { deck: "code", tKey: "mem.deckCode", Icon: IconCode },
  { deck: "text", tKey: "mem.deckText", Icon: IconFileText },
];
const CODE_SRC: { src: SrsSource; tKey: string }[] = [
  { src: "token", tKey: "mem.srcToken" },
  { src: "concept", tKey: "mem.srcConcept" },
];

// 통계 모달 전용 경량 덱 선택기 — 어느 덱의 통계를 볼지 고른다. 덱/출처/커스텀 선택은 controlled
// (MemorizeView 소유, 복습 암기 모달과 공유). DeckSelect(시작 화면)와 달리 시작 버튼·옵션 없음.
export default function DeckStatPicker({
  deck, codeSources, customId, customDecks, onDeckChange, onCodeSourcesChange, onSelectCustom,
}: {
  deck: Deck;
  codeSources: Set<SrsSource>;
  customId: string | null;
  customDecks: CustomDeck[];
  onDeckChange: (d: Deck) => void;
  onCodeSourcesChange: (s: Set<SrsSource>) => void;
  onSelectCustom: (id: string | null) => void;
}) {
  const t = useT();
  const pill = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
      on ? "bg-[#3B34E2] text-white shadow-sm" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
    }`;
  // 코드 출처 토글 — 마지막 하나는 못 끄게(빈 선택이면 통계가 비어버림).
  function toggleSource(s: SrsSource) {
    const next = new Set(codeSources);
    if (next.has(s)) { if (next.size > 1) next.delete(s); } else next.add(s);
    onCodeSourcesChange(next);
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 고정 덱 — 알약 3개 */}
        {FIXED.map(({ deck: d, tKey, Icon }) => (
          <button key={d} type="button" onClick={() => onDeckChange(d)} className={pill(!customId && deck === d)}>
            <Icon size={14} stroke={2} aria-hidden /> {t(tKey)}
          </button>
        ))}
        {/* 커스텀 덱 — 많아질 수 있어 풀다운. 선택 시 customId, 비우면 고정 덱으로. */}
        {customDecks.length > 0 && (
          <select
            value={customId ?? ""}
            onChange={(e) => (e.target.value ? onSelectCustom(e.target.value) : onDeckChange(deck))}
            className={`ml-1 shrink-0 rounded-lg border px-2.5 py-1.5 text-xs outline-none transition focus:border-[#3B34E2] ${
              customId
                ? "border-[#3B34E2] bg-[#3B34E2]/10 font-medium text-[#3B34E2] dark:text-[#8b86f5]"
                : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
            }`}
          >
            <option value="">{t("mem.customDecks")}</option>
            {customDecks.map((cd) => (
              <option key={cd.id} value={cd.id} className="bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{cd.name}</option>
            ))}
          </select>
        )}
      </div>
      {!customId && deck === "code" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {CODE_SRC.map(({ src, tKey }) => (
            <button key={src} type="button" onClick={() => toggleSource(src)} className={pill(codeSources.has(src))}>
              {t(tKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
