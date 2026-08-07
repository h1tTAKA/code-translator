"use client";
// 워크스페이스 문서 뷰어(#693) — 문서 폴더의 .md/.txt를 읽어 렌더. .md는 Markdown(읽기용),
// 그 외는 평문(pre). /api/repo/file 재사용(root=docsRoot 스코프). 헤더에 파일명 + 닫기(dock 컨트롤은 커밋3~4).
import { useEffect, useState } from "react";
import { IconLoader2, IconFileText, IconLayoutNavbar, IconLayoutBottombar, IconTerminal2, IconFileCode } from "@tabler/icons-react";
import Markdown from "@/components/learning/Markdown";
import { useT } from "@/lib/i18n/I18nProvider";

// pos/onTogglePos: 상하 분할 시 위/아래 토글. region/onToggleRegion: 터미널↔코드 영역 이동(#693).
export default function DocPane({ root, file, onClose, pos, onTogglePos, region, onToggleRegion }: {
  root: string; file: string; onClose: () => void;
  pos?: "top" | "bottom"; onTogglePos?: () => void;
  region?: "terminal" | "code"; onToggleRegion?: () => void;
}) {
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
  const name = file.split("/").pop() ?? file;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <IconFileText size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
        <span className="truncate">{name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {onToggleRegion && (
            <button type="button" onClick={onToggleRegion} title={region === "code" ? t("workspace.docToTerminal") : t("workspace.docToCode")} className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
              {region === "code" ? <IconTerminal2 size={13} stroke={2} aria-hidden /> : <IconFileCode size={13} stroke={2} aria-hidden />}
            </button>
          )}
          {onTogglePos && (
            <button type="button" onClick={onTogglePos} title={pos === "top" ? t("workspace.docMoveBottom") : t("workspace.docMoveTop")} className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
              {pos === "top" ? <IconLayoutBottombar size={13} stroke={2} aria-hidden /> : <IconLayoutNavbar size={13} stroke={2} aria-hidden />}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label={t("mem.close")}>×</button>
        </div>
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-auto p-3">
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
    </div>
  );
}
