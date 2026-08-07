"use client";
// 워크스페이스 문서 콘텐츠 렌더(#693) — 한 문서(.md=Markdown, 그 외=평문)를 읽어 그림.
// 탭 바·dock 컨트롤·닫기는 상위 DocViewer(#693 멀티탭)가 담당. /api/repo/file 재사용(root=docsRoot 스코프).
import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import Markdown from "@/components/learning/Markdown";
import { useT } from "@/lib/i18n/I18nProvider";

export default function DocPane({ root, file }: { root: string; file: string }) {
  const t = useT();
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 문서 변경 시 재로드
    setStatus("loading");
    (async () => {
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file }) });
        const d = await r.json();
        if (cancelled) return;
        if (r.ok && typeof d.content === "string") { setContent(d.content); setStatus("ok"); }
        else { setContent(""); setStatus("error"); }
      } catch { if (!cancelled) { setContent(""); setStatus("error"); } }
    })();
    return () => { cancelled = true; };
  }, [root, file]);

  const isMd = /\.(md|markdown)$/i.test(file);
  return (
    <div className="nunopi-scroll h-full min-h-0 overflow-auto p-3">
      {status === "loading" ? (
        <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={15} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : status === "error" ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.docLoadFail")}</div>
      ) : isMd ? (
        <Markdown>{content}</Markdown>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">{content}</pre>
      )}
    </div>
  );
}
