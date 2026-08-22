"use client";
// 이슈·PR 코멘트 작성 컴포저(#820) — orca식 카드(textarea + 서식 툴바 + 취소/Send).
// 서식 버튼은 선택영역에 Markdown 삽입. Cmd/Ctrl+Enter 전송. write라 명시적 Send만.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconBold, IconItalic, IconCode, IconQuote, IconList } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

export default function CommentComposer({ root, kind, number, onPosted }: { root: string; kind: "issue" | "pr"; number: number; onPosted: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // 선택영역을 좌우 마커로 감싸기(**, _, `). 커서/선택 유지.
  const wrap = (mark: string) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    setText((v) => v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = s + mark.length; ta.selectionEnd = e + mark.length; });
  };
  // 현재 줄 맨 앞에 접두어(> , - ).
  const linePrefix = (p: string) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart;
    setText((v) => { const ls = v.lastIndexOf("\n", s - 1) + 1; return v.slice(0, ls) + p + v.slice(ls); });
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + p.length; });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const gh = window.nunopiDesktop?.github;
    if (!gh?.addComment) { setError(t("github.desktopOnly")); return; }
    setSending(true); setError(null);
    try {
      const r = await gh.addComment(root, kind, number, body);
      if (!mountedRef.current) return;
      if (r.ok) { setText(""); setSending(false); onPosted(); }
      else { setSending(false); setError(r.detail || t("github.error")); }
    } catch (e) {
      if (mountedRef.current) { setSending(false); setError(String((e as Error)?.message || e)); }
    }
  };

  const toolBtn = "rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      <div className="rounded-lg border border-zinc-200 bg-white transition focus-within:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={taRef} value={text} onChange={(e) => setText(e.target.value)} disabled={sending}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
          placeholder={t("github.commentPlaceholder")} rows={3}
          className="w-full resize-y bg-transparent px-2.5 py-2 text-[12px] text-zinc-700 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-200 dark:placeholder:text-zinc-500" />
        {/* 하단 툴바 + 액션 */}
        <div className="flex items-center gap-0.5 border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800/60">
          <button type="button" onClick={() => wrap("**")} className={toolBtn} title="Bold" aria-label="Bold"><IconBold size={13} stroke={2} aria-hidden /></button>
          <button type="button" onClick={() => wrap("_")} className={toolBtn} title="Italic" aria-label="Italic"><IconItalic size={13} stroke={2} aria-hidden /></button>
          <button type="button" onClick={() => wrap("`")} className={toolBtn} title="Code" aria-label="Code"><IconCode size={13} stroke={2} aria-hidden /></button>
          <button type="button" onClick={() => linePrefix("> ")} className={toolBtn} title="Quote" aria-label="Quote"><IconQuote size={13} stroke={2} aria-hidden /></button>
          <button type="button" onClick={() => linePrefix("- ")} className={toolBtn} title="List" aria-label="List"><IconList size={13} stroke={2} aria-hidden /></button>
          <div className="ml-auto flex items-center gap-1">
            {text && !sending && <button type="button" onClick={() => setText("")} className="rounded px-2 py-0.5 text-[11px] text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200">{t("github.cancel")}</button>}
            <button type="button" onClick={() => void send()} disabled={sending || !text.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500">
              {sending && <IconLoader2 size={12} className="animate-spin" aria-hidden />}
              {sending ? t("github.sending") : t("github.send")}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="break-words px-1 text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}
