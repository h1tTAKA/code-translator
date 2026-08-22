"use client";
// 이슈·PR 코멘트 작성 컴포저(#820) — textarea + Send. 성공 시 onPosted()로 부모가 상세 재조회.
// Markdown 지원(gh comment --body). Cmd/Ctrl+Enter 전송. write라 명시적 Send만(자동 전송 X).
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconSend, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

export default function CommentComposer({ root, kind, number, onPosted }: { root: string; kind: "issue" | "pr"; number: number; onPosted: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800/60">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} disabled={sending}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
        placeholder={t("github.commentPlaceholder")} rows={3}
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500" />
      {error && <p className="flex items-start gap-1 text-[10px] text-rose-500"><IconAlertTriangle size={12} className="mt-px shrink-0" aria-hidden /><span className="break-words">{error}</span></p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => void send()} disabled={sending || !text.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-mustard-500 px-2.5 py-1 text-[11px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-40">
          {sending ? <IconLoader2 size={12} className="animate-spin" aria-hidden /> : <IconSend size={12} stroke={2} aria-hidden />}
          {sending ? t("github.sending") : t("github.send")}
        </button>
      </div>
    </div>
  );
}
