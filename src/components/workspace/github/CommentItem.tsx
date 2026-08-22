"use client";
// 코멘트 한 개(#820) — 표시 / 인라인 수정 / 삭제 확인. 자기 코멘트(viewerDidAuthor)만 수정·삭제 노출.
// 성공 시 onChanged()로 부모 재조회. commentId는 url의 #issuecomment-<id>에서 파싱.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconPencil, IconTrash } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import Markdown from "@/components/learning/Markdown";
import GhAvatar from "@/components/workspace/github/GhAvatar";
import { relTime } from "@/lib/relTime";

function parseCommentId(url: string | undefined): string | null {
  const m = (url || "").match(/#issuecomment-(\d+)/);
  return m ? m[1] : null;
}

export default function CommentItem({ root, comment, onChanged }: { root: string; comment: GhComment; onChanged: () => void }) {
  const t = useT();
  const id = parseCommentId(comment.url);
  const canEdit = !!comment.viewerDidAuthor && !!id;
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const gh = () => window.nunopiDesktop?.github;

  const saveEdit = async () => {
    const body = draft.trim();
    if (!body || !id || busy) return;
    setBusy(true); setError(null);
    const r = await gh()?.editComment?.(root, id, body);
    if (!mountedRef.current) return;
    setBusy(false);
    if (r?.ok) { setMode("view"); onChanged(); } else setError(r?.detail || t("github.error"));
  };
  const doDelete = async () => {
    if (!id || busy) return;
    setBusy(true); setError(null);
    const r = await gh()?.deleteComment?.(root, id);
    if (!mountedRef.current) return;
    setBusy(false);
    if (r?.ok) onChanged(); else { setError(r?.detail || t("github.error")); setMode("view"); }
  };

  return (
    <div className="group rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/40">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
        <GhAvatar login={comment.author?.login} size={16} />
        <span>{comment.author?.login}</span>
        {comment.createdAt && <span>· {relTime(comment.createdAt)}</span>}
        {canEdit && mode === "view" && (
          <span className="ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button type="button" onClick={() => { setDraft(comment.body); setMode("edit"); }} className="rounded p-0.5 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200" title={t("github.edit")} aria-label={t("github.edit")}><IconPencil size={12} stroke={2} aria-hidden /></button>
            <button type="button" onClick={() => setMode("confirmDelete")} className="rounded p-0.5 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/40 dark:hover:text-rose-400" title={t("github.delete")} aria-label={t("github.delete")}><IconTrash size={12} stroke={2} aria-hidden /></button>
          </span>
        )}
      </div>

      {mode === "edit" ? (
        <div className="flex flex-col gap-1">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} rows={3}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void saveEdit(); } }}
            className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => { setMode("view"); setError(null); }} className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">{t("github.cancel")}</button>
            <button type="button" onClick={() => void saveEdit()} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white">
              {busy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.save")}
            </button>
          </div>
        </div>
      ) : (
        <Markdown className="text-[12px]">{comment.body}</Markdown>
      )}

      {mode === "confirmDelete" && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
          <span className="flex-1">{t("github.deleteConfirm")}</span>
          <button type="button" onClick={() => setMode("view")} className="rounded px-1.5 py-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/40">{t("github.cancel")}</button>
          <button type="button" onClick={() => void doDelete()} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-2 py-0.5 font-medium text-white hover:bg-rose-600 disabled:opacity-40">
            {busy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.delete")}
          </button>
        </div>
      )}
      {error && <p className="mt-1 break-words text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}
