"use client";
// 리액션 바(#822) — reactionGroups 칩(클릭=토글) + 😊 피커. 코멘트·이슈/PR 본문 공용.
// onReact(content)만 주입 — 코멘트는 comment react, 본문은 body-react로 각각 연결.
import { useState } from "react";
import { IconMoodSmile } from "@tabler/icons-react";

export const REACTIONS: { rest: string; emoji: string; enum: string }[] = [
  { rest: "+1", emoji: "👍", enum: "THUMBS_UP" },
  { rest: "-1", emoji: "👎", enum: "THUMBS_DOWN" },
  { rest: "laugh", emoji: "😄", enum: "LAUGH" },
  { rest: "hooray", emoji: "🎉", enum: "HOORAY" },
  { rest: "confused", emoji: "😕", enum: "CONFUSED" },
  { rest: "heart", emoji: "❤️", enum: "HEART" },
  { rest: "rocket", emoji: "🚀", enum: "ROCKET" },
  { rest: "eyes", emoji: "👀", enum: "EYES" },
];
const ENUM_TO_REACTION = new Map(REACTIONS.map((r) => [r.enum, r]));

export default function ReactionBar({ groups, onReact }: { groups?: GhReactionGroup[]; onReact: (content: string) => void }) {
  const [picker, setPicker] = useState(false);
  const active = (groups || []).filter((g) => g.users?.totalCount > 0);
  const react = (content: string) => { setPicker(false); onReact(content); };
  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {active.map((g) => {
        const rx = ENUM_TO_REACTION.get(g.content);
        if (!rx) return null;
        return (
          <button key={g.content} type="button" onClick={() => react(rx.rest)}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-px text-[11px] text-zinc-600 transition hover:border-mustard-500/60 dark:border-zinc-700 dark:text-zinc-300">
            <span>{rx.emoji}</span><span className="text-[10px] text-zinc-400 dark:text-zinc-500">{g.users.totalCount}</span>
          </button>
        );
      })}
      <button type="button" onClick={() => setPicker((v) => !v)} aria-label="react"
        className="inline-flex items-center rounded-full border border-transparent p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
        <IconMoodSmile size={13} stroke={2} aria-hidden />
      </button>
      {picker && (
        <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
          {REACTIONS.map((rx) => (
            <button key={rx.rest} type="button" onClick={() => react(rx.rest)} title={rx.rest}
              className="rounded p-1 text-[15px] leading-none transition hover:bg-zinc-100 dark:hover:bg-zinc-700">{rx.emoji}</button>
          ))}
        </div>
      )}
    </div>
  );
}
