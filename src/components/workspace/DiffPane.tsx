"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff를 빨강(−)/초록(+)으로. before/after 한 눈에.
import { useEffect, useState } from "react";
import { IconLoader2, IconAlertTriangle } from "@tabler/icons-react";

interface DLine { kind: "hunk" | "add" | "del" | "ctx" | "meta"; oldN: number | null; newN: number | null; text: string }

// git diff 유니파이드 → 줄별 파싱(줄번호 포함).
function parseDiff(diff: string): DLine[] {
  const out: DLine[] = [];
  let oldN = 0, newN = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) { oldN = Number(m[1]); newN = Number(m[2]); }
      out.push({ kind: "hunk", oldN: null, newN: null, text: raw });
    } else if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("similarity") || raw.startsWith("rename ")) {
      out.push({ kind: "meta", oldN: null, newN: null, text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", oldN: null, newN: newN++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", oldN: oldN++, newN: null, text: raw.slice(1) });
    } else {
      out.push({ kind: "ctx", oldN: oldN++, newN: newN++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

export default function DiffPane({ root, hash, file }: { root: string; hash: string; file: string }) {
  const [lines, setLines] = useState<DLine[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setLines(null);
    (async () => {
      try {
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || !d.ok) { setStatus("error"); return; }
        setLines(parseDiff(String(d.diff ?? ""))); setStatus("ok");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, hash, file]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "error" || !lines) return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> diff 실패</div>;

  return (
    <div className="nunopi-scroll h-full overflow-auto bg-white font-mono text-[11px] leading-[1.5] dark:bg-[#0b0c12]">
      {lines.map((l, i) => {
        const bg = l.kind === "add" ? "bg-emerald-500/10" : l.kind === "del" ? "bg-rose-500/10" : "";
        const mark = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
        const markCls = l.kind === "add" ? "text-emerald-600 dark:text-emerald-500" : l.kind === "del" ? "text-rose-600 dark:text-rose-500" : "text-transparent";
        if (l.kind === "hunk") return <div key={i} className="bg-[#3B34E2]/5 px-2 py-0.5 text-[10px] text-[#3B34E2] dark:bg-[#8b86f5]/10 dark:text-[#8b86f5]">{l.text}</div>;
        if (l.kind === "meta") return <div key={i} className="px-2 text-[10px] text-zinc-400 dark:text-zinc-600">{l.text}</div>;
        return (
          <div key={i} className={`flex ${bg}`}>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">{l.oldN ?? ""}</span>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">{l.newN ?? ""}</span>
            <span className={`w-4 shrink-0 select-none text-center ${markCls}`}>{mark}</span>
            <span className="whitespace-pre px-1 text-zinc-700 dark:text-zinc-200">{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}
