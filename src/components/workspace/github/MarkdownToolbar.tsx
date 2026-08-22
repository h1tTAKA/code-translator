"use client";
// Markdown 서식 툴바(#822) — 코멘트/본문 편집 공용. 선택영역 감싸기(**,_,`) + 줄 접두어(> , - ).
import type { RefObject } from "react";
import { IconBold, IconItalic, IconCode, IconQuote, IconList } from "@tabler/icons-react";

export default function MarkdownToolbar({ taRef, setValue, className }: {
  taRef: RefObject<HTMLTextAreaElement | null>;
  setValue: (updater: (v: string) => string) => void;
  className?: string;
}) {
  // 선택영역을 좌우 마커로 감싸기. 커서/선택 유지.
  const wrap = (mark: string) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    setValue((v) => v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = s + mark.length; ta.selectionEnd = e + mark.length; });
  };
  // 현재 줄 맨 앞에 접두어.
  const linePrefix = (p: string) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart;
    setValue((v) => { const ls = v.lastIndexOf("\n", s - 1) + 1; return v.slice(0, ls) + p + v.slice(ls); });
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + p.length; });
  };
  const toolBtn = "rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
  return (
    <div className={`flex items-center gap-0.5 ${className || ""}`}>
      <button type="button" onClick={() => wrap("**")} className={toolBtn} title="Bold" aria-label="Bold"><IconBold size={13} stroke={2} aria-hidden /></button>
      <button type="button" onClick={() => wrap("_")} className={toolBtn} title="Italic" aria-label="Italic"><IconItalic size={13} stroke={2} aria-hidden /></button>
      <button type="button" onClick={() => wrap("`")} className={toolBtn} title="Code" aria-label="Code"><IconCode size={13} stroke={2} aria-hidden /></button>
      <button type="button" onClick={() => linePrefix("> ")} className={toolBtn} title="Quote" aria-label="Quote"><IconQuote size={13} stroke={2} aria-hidden /></button>
      <button type="button" onClick={() => linePrefix("- ")} className={toolBtn} title="List" aria-label="List"><IconList size={13} stroke={2} aria-hidden /></button>
    </div>
  );
}
