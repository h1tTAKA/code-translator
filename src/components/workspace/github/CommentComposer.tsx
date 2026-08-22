"use client";
// 이슈·PR 코멘트 작성 컴포저(#820) — orca식 카드(textarea + 서식 툴바 + 취소/Send).
// 서식 버튼은 선택영역에 Markdown 삽입. Cmd/Ctrl+Enter 전송. write라 명시적 Send만.
import { useEffect, useRef, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";

export default function CommentComposer({ root, kind, number, onPosted }: { root: string; kind: "issue" | "pr"; number: number; onPosted: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

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
          <MarkdownToolbar taRef={taRef} setValue={setText} />
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
