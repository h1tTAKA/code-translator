"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff. shiki 신택스 하이라이팅 + 빨강(−)/초록(+) 배경.
import { useEffect, useState } from "react";
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";
import { IconLoader2, IconAlertTriangle } from "@tabler/icons-react";

interface DLine { kind: "hunk" | "add" | "del" | "ctx" | "meta"; oldN: number | null; newN: number | null; text: string; ctxLabel?: string }

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", json: "json",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", c: "c", h: "c",
  cpp: "cpp", cs: "csharp", swift: "swift", css: "css", scss: "scss", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "bash", sql: "sql", toml: "toml",
};
const langOf = (file: string) => EXT_LANG[file.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

function parseDiff(diff: string): DLine[] {
  const out: DLine[] = [];
  let oldN = 0, newN = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
      if (m) { oldN = Number(m[1]); newN = Number(m[2]); }
      out.push({ kind: "hunk", oldN: null, newN: null, text: raw, ctxLabel: (m?.[3] ?? "").trim() });
    } else if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(raw)) {
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
  const [tokens, setTokens] = useState<ThemedToken[][]>([]); // 코드줄(add/del/ctx) 순서별 하이라이트 토큰
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 테마 초기 감지(1회)
    setIsDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- diff 바뀌면 로딩 리셋(키 변경 시)
    setStatus("loading"); setLines(null); setTokens([]);
    (async () => {
      try {
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || !d.ok) { setStatus("error"); return; }
        const parsed = parseDiff(String(d.diff ?? ""));
        // 코드줄만 모아 한 번에 하이라이트 → 줄별 토큰.
        const codeText = parsed.filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx").map((l) => l.text).join("\n");
        let toks: ThemedToken[][] = [];
        try { toks = (await codeToTokens(codeText, { lang: langOf(file) as BundledLanguage, theme: isDark ? "github-dark" : "github-light" })).tokens; } catch { toks = []; }
        if (cancelled) return;
        setLines(parsed); setTokens(toks); setStatus("ok");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, hash, file, isDark]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "error" || !lines) return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> diff 실패</div>;

  let codeIdx = 0; // add/del/ctx 진행 인덱스 → tokens 매칭
  return (
    <div className="relative h-full bg-white dark:bg-[#0b0c12]">
      <div className="nunopi-scroll h-full overflow-auto pr-2.5 font-mono text-[11px] leading-[1.55]">
      {lines.map((l, i) => {
        if (l.kind === "meta") return null; // diff/index/+++/--- 헤더 숨김(잡음)
        if (l.kind === "hunk") return (
          // 건너뛴(안 바뀐) 구간 표시만 — 얇은 구분선 + ⋯. 함수 컨텍스트는 title(호버)로.
          <div key={i} className="flex select-none items-center gap-2 px-2 py-1 text-zinc-300 dark:text-zinc-700" title={l.ctxLabel || undefined}>
            <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" /><span className="text-[10px]">⋯</span><span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
          </div>
        );
        const tok = tokens[codeIdx++]; // 이 코드줄의 토큰
        const bg = l.kind === "add" ? "bg-emerald-500/10" : l.kind === "del" ? "bg-rose-500/10" : "";
        const mark = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
        const markCls = l.kind === "add" ? "text-emerald-600 dark:text-emerald-500" : l.kind === "del" ? "text-rose-600 dark:text-rose-500" : "text-transparent";
        return (
          <div key={i} className={`flex ${bg}`}>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.oldN ?? ""}</span>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.newN ?? ""}</span>
            <span className={`w-4 shrink-0 select-none text-center ${markCls}`}>{mark}</span>
            <span className="whitespace-pre px-1">
              {tok ? tok.map((tk, j) => <span key={j} style={{ color: tk.color }}>{tk.content}</span>) : <span className="text-zinc-700 dark:text-zinc-200">{l.text}</span>}
            </span>
          </div>
        );
      })}
      </div>
      {/* 오른쪽 변경 오버뷰 룰러 — 파일 전체서 어디가 바뀌었는지(초록=추가·빨강=삭제) 미니맵. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2 border-l border-zinc-100 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/30">
        {lines.map((l, i) => (l.kind === "add" || l.kind === "del") ? (
          <div key={i} className={`absolute right-0 h-[2px] w-full ${l.kind === "add" ? "bg-emerald-500" : "bg-rose-500"}`} style={{ top: `${(i / Math.max(1, lines.length)) * 100}%` }} />
        ) : null)}
      </div>
    </div>
  );
}
