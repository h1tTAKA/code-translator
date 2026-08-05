"use client";
// 워크스페이스 코드칸(#647) — 파일 클릭 시 소스 읽어 shiki로 하이라이트(읽기전용). 다크 전환 대응.
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { IconLoader2, IconAlertTriangle } from "@tabler/icons-react";

// 확장자 → shiki 언어. 없으면 text.
const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  rb: "ruby", php: "php", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  css: "css", scss: "scss", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "bash", sql: "sql", toml: "toml",
};
const langOf = (file: string) => EXT_LANG[file.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

export default function CodePane({ root, file }: { root: string; file: string }) {
  const [html, setHtml] = useState<string>("");
  const [raw, setRaw] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 파일 바뀌면 로딩 리셋(마운트/키변경 시 1회)
    setStatus("loading"); setHtml(""); setRaw("");
    (async () => {
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file }) });
        const d = await r.json();
        if (!r.ok) { if (!cancelled) setStatus("error"); return; }
        const src: string = d.content ?? "";
        if (!cancelled) { setRaw(src); setStatus("ok"); }
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, file]);

  // raw/테마 바뀌면 재하이라이트.
  useEffect(() => {
    if (status !== "ok") return;
    let cancelled = false;
    codeToHtml(raw, { lang: langOf(file), theme: isDark ? "github-dark" : "github-light" })
      .then((out) => { if (!cancelled) setHtml(out); })
      .catch(() => { if (!cancelled) setHtml(""); });
    return () => { cancelled = true; };
  }, [raw, file, isDark, status]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "error") return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> {file}</div>;

  return (
    <div className="nunopi-scroll h-full overflow-auto bg-white p-3 text-[12px] dark:bg-[#0b0c12] [&_pre]:!m-0 [&_pre]:!bg-transparent">
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="text-zinc-700 dark:text-zinc-200">{raw}</pre>}
    </div>
  );
}
