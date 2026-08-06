"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff. shiki 신택스 하이라이팅 + 빨강(−)/초록(+) 배경.
import { Fragment, useEffect, useRef, useState } from "react";
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";
import { IconLoader2, IconAlertTriangle, IconGitCompare, IconSparkles } from "@tabler/icons-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import Markdown from "@/components/learning/Markdown";
import { parseCardSuggestions } from "@/lib/cardSuggestion";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

interface DLine { kind: "hunk" | "add" | "del" | "ctx" | "meta"; oldN: number | null; newN: number | null; text: string; ctxLabel?: string }

// 변경 구간(우리의 "hunk") — 연속 add/del 런. 사이 컨텍스트가 짧으면 한 구간으로 병합(주석 폭발 방지).
// -U100000이라 파일당 @@가 1개뿐 → 표준 hunk 대신 실제 바뀐 블록을 단위로.
interface Hunk { id: number; startLine: number; endLine: number; diffText: string }
const MERGE_GAP = 3;   // 변경 사이 컨텍스트 줄이 이 이하면 같은 구간
const CTX_LINES = 3;   // diffText에 실을 앞뒤 컨텍스트 줄 수
const MAX_DIFF = 4000; // diffText 상한(토큰 방어)

function groupHunks(lines: DLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let start = -1, lastChange = -1;
  const flush = () => {
    if (start < 0) return;
    const from = Math.max(0, start - CTX_LINES);
    const to = Math.min(lines.length - 1, lastChange + CTX_LINES);
    const diffText = lines.slice(from, to + 1)
      .filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx")
      .map((l) => (l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ") + l.text)
      .join("\n").slice(0, MAX_DIFF);
    hunks.push({ id: hunks.length, startLine: start, endLine: lastChange, diffText });
    start = -1; lastChange = -1;
  };
  lines.forEach((l, i) => {
    if (l.kind !== "add" && l.kind !== "del") return;
    if (start >= 0 && i - lastChange - 1 > MERGE_GAP) flush(); // 컨텍스트 간격 크면 새 구간
    if (start < 0) start = i;
    lastChange = i;
  });
  flush();
  return hunks;
}

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

export default function DiffPane({ root, hash, file, worktree, providerId, providerSettings }: { root: string; hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked"; providerId: AgentProviderKind; providerSettings: ProviderSettings }) {
  const t = useT();
  const { locale } = useLocale();
  // 변경 구간별 에이전트 노트. key = diffText 해시(구간 내용 기반 안정 키 → 같은 diff 재오픈 시 매칭).
  const [notes, setNotes] = useState<Record<string, { status: "loading" | "done" | "error"; text?: string }>>({});
  const [lines, setLines] = useState<DLine[] | null>(null);
  const [tokens, setTokens] = useState<ThemedToken[][]>([]); // 코드줄(add/del/ctx) 순서별 하이라이트 토큰
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "empty">("loading");
  const [isDark, setIsDark] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const draggingRuler = useRef(false);
  const [vp, setVp] = useState({ top: 0, height: 100 }); // 오버뷰 썸(현재 보이는 구간, %)
  const [showRuler, setShowRuler] = useState(false);     // 오버뷰 미니맵 표시(스크롤·호버 시만)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = () => { setShowRuler(true); if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowRuler(false), 1200); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const syncVp = () => {
    const el = scrollRef.current; if (!el) return;
    const h = el.scrollHeight || 1;
    setVp({ top: (el.scrollTop / h) * 100, height: Math.min(100, (el.clientHeight / h) * 100) });
  };
  useEffect(() => { if (status === "ok") syncVp(); }, [status, lines]);

  // 노트 영속 — diff 신원별 localStorage. 재오픈 시 저장된 설명 복원.
  const noteStore = `nunopi:hunk-notes:${root}:${hash ?? (worktree ? "wt:" + worktree : "")}:${file}`;
  // 구간 내용(diffText) 기반 안정 키 — 인덱스가 아니라 내용이라 같은 diff 재오픈 시 매칭, 편집되면 자연 미스.
  const hunkKey = (h: Hunk) => { let x = 0; for (let i = 0; i < h.diffText.length; i++) x = (Math.imul(x, 31) + h.diffText.charCodeAt(i)) | 0; return String(x); };
  const persist = (map: Record<string, { status: "loading" | "done" | "error"; text?: string }>) => {
    try { const done: Record<string, string> = {}; for (const k in map) if (map[k].status === "done" && map[k].text) done[k] = map[k].text!; localStorage.setItem(noteStore, JSON.stringify(done)); } catch { /* ignore */ }
  };
  // diff(파일/커밋/워킹트리) 바뀌면 저장된 노트 로드(없으면 빈).
  useEffect(() => {
    let loaded: Record<string, { status: "done"; text: string }> = {};
    try { const raw = localStorage.getItem(noteStore); if (raw) { const m = JSON.parse(raw) as Record<string, string>; for (const k in m) loaded[k] = { status: "done", text: m[k] }; } } catch { loaded = {}; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- diff 키 변경 시 저장 노트 복원
    setNotes(loaded);
  }, [noteStore]);

  // 변경 구간 온디맨드 설명 — analyze mode:chat 재사용(서버 변경 0). 로딩→최종(카드 블록 제거) → 영속.
  async function explainHunk(h: Hunk) {
    const key = hunkKey(h);
    if (notes[key]?.status === "loading") return; // 중복 가드
    setNotes((p) => ({ ...p, [key]: { status: "loading" } }));
    try {
      const prompt = "아래는 코드 변경(diff)입니다(- 삭제, + 추가). 다음을 쉬운 말로, 그러나 정확하게 설명해줘:\n1) 무엇을 바꿨는지 한 문장.\n2) 바뀐(+ 표시된) 코드가 실제로 하는 일을 한 줄씩 또는 흐름으로 풀어서 읽어줘.\n3) 왜 이렇게 바꿨는지(의도·이유).\n4) 어떤 효과·영향이 있는지.\n주니어 개발자도 이해할 만큼 쉽게. 짧고 명확하게. '답변' 같은 제목·머리말 없이 바로 내용부터 시작하고, 큰 제목(#, ##)은 쓰지 마세요. 카드는 만들지 마세요.";
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: h.diffText, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
      });
      if (!res.ok || !res.body) { setNotes((p) => ({ ...p, [key]: { status: "error" } })); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", answer = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response.summary; }
      }
      const clean = parseCardSuggestions(answer || "").text || answer || "(빈 응답)";
      setNotes((p) => { const n = { ...p, [key]: { status: "done" as const, text: clean } }; persist(n); return n; });
    } catch { setNotes((p) => ({ ...p, [key]: { status: "error" } })); }
  }

  const jumpToY = (clientY: number) => {
    const el = scrollRef.current, ruler = rulerRef.current; if (!el || !ruler) return;
    const rect = ruler.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    el.scrollTop = frac * (el.scrollHeight - el.clientHeight);
  };
  // 룰러 드래그로 스크롤(썸 잡고 끌기).
  useEffect(() => {
    const mm = (e: MouseEvent) => { if (draggingRuler.current) jumpToY(e.clientY); };
    const mu = () => { draggingRuler.current = false; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
  }, []);
  const rulerDown = (e: React.MouseEvent) => { draggingRuler.current = true; document.body.style.userSelect = "none"; jumpToY(e.clientY); };

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
        // 워킹트리(커밋 전) diff면 git-diff, 커밋 diff면 git-show.
        const r = worktree
          ? await fetch("/api/repo/git-diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, file, kind: worktree }) })
          : await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || !d.ok) { setStatus("error"); return; }
        const raw = String(d.diff ?? "");
        // 변경 없음(이미 커밋됐거나 목록이 오래됨) → 빈 창 대신 안내.
        if (!raw.trim()) { setStatus("empty"); return; }
        const parsed = parseDiff(raw);
        // 코드줄만 모아 한 번에 하이라이트 → 줄별 토큰.
        const codeText = parsed.filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx").map((l) => l.text).join("\n");
        let toks: ThemedToken[][] = [];
        try { toks = (await codeToTokens(codeText, { lang: langOf(file) as BundledLanguage, theme: isDark ? "github-dark" : "github-light" })).tokens; } catch { toks = []; }
        if (cancelled) return;
        setLines(parsed); setTokens(toks); setStatus("ok");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, hash, file, worktree, isDark]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "empty") return <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-[12px] text-zinc-400 dark:text-zinc-500"><IconGitCompare size={16} stroke={1.75} aria-hidden /><span>{t("workspace.diffEmpty")}</span></div>;
  if (status === "error" || !lines) return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> diff 실패</div>;

  let codeIdx = 0; // add/del/ctx 진행 인덱스 → tokens 매칭
  // 오버뷰 룰러용: 연속 "같은 종류(추가/삭제)" 줄을 한 블록으로. 수정(삭제+추가)은 빨강 블록·초록 블록 따로 →
  // 삭제도 빨강으로 보임. (줄마다 틱 찍으면 새파일서 바코드 벽이라 병합.)
  const total = Math.max(1, lines.length);
  const blocks: { top: number; height: number; add: boolean }[] = [];
  { let s = -1; let kind: "add" | "del" | null = null;
    const flush = (end: number) => { if (s >= 0 && kind) blocks.push({ top: (s / total) * 100, height: Math.max(0.5, ((end - s) / total) * 100), add: kind === "add" }); };
    lines.forEach((l, i) => {
      const k = l.kind === "add" ? "add" : l.kind === "del" ? "del" : null;
      if (k) { if (s < 0) { s = i; kind = k; } else if (k !== kind) { flush(i); s = i; kind = k; } }
      else if (s >= 0) { flush(i); s = -1; kind = null; }
    });
    if (s >= 0) flush(lines.length);
  }
  // 변경 구간 → 시작 줄에 버튼(위), 끝 줄에 노트(아래) 앵커.
  const allHunks = groupHunks(lines);
  const hunkStart = new Map(allHunks.map((h) => [h.startLine, h]));
  const hunkEnd = new Map(allHunks.map((h) => [h.endLine, h]));
  return (
    <div className="relative h-full bg-white dark:bg-[#0b0c12]"
      onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowRuler(true); }}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowRuler(false), 400); }}>
      <div ref={scrollRef} onScroll={() => { syncVp(); reveal(); }} className="h-full overflow-auto pr-3 font-mono text-[11px] leading-[1.55] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {lines.map((l, i) => {
        // meta(diff/index/+++/---) + hunk(@@) 헤더 숨김 — -U100000으로 전체 컨텍스트라 생략 구분선 불필요.
        if (l.kind === "meta" || l.kind === "hunk") return null;
        const tok = tokens[codeIdx++]; // 이 코드줄의 토큰
        const bg = l.kind === "add" ? "bg-emerald-500/20" : l.kind === "del" ? "bg-rose-500/20" : "";
        const mark = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
        const markCls = l.kind === "add" ? "text-emerald-600 dark:text-emerald-500" : l.kind === "del" ? "text-rose-600 dark:text-rose-500" : "text-transparent";
        const startH = hunkStart.get(i); // 구간 시작 → 위에 설명 버튼
        const endH = hunkEnd.get(i);     // 구간 끝 → 아래에 노트
        const row = (
          <div key={i} className={`flex w-max min-w-full ${bg}`}>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.oldN ?? ""}</span>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.newN ?? ""}</span>
            <span className={`w-4 shrink-0 select-none text-center ${markCls}`}>{mark}</span>
            <span className="whitespace-pre px-1">
              {tok ? tok.map((tk, j) => <span key={j} style={{ color: tk.color }}>{tk.content}</span>) : <span className="text-zinc-700 dark:text-zinc-200">{l.text}</span>}
            </span>
          </div>
        );
        if (!startH && !endH) return row;
        const startNote = startH ? notes[hunkKey(startH)] : undefined;
        const endNote = endH ? notes[hunkKey(endH)] : undefined;
        return (
          <Fragment key={`h-${i}`}>
            {/* 구간 시작: 위에 설명 버튼 */}
            {startH && (
              <div className="flex items-center py-1 pl-[4.75rem]">
                <button type="button" onClick={() => void explainHunk(startH)} disabled={startNote?.status === "loading"}
                  className="inline-flex items-center gap-1 rounded-md bg-[#3B34E2] px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-[#322bc9] disabled:opacity-60 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
                  {startNote?.status === "loading"
                    ? <><IconLoader2 size={11} stroke={2.5} className="animate-spin" aria-hidden />{t("workspace.hunkExplaining")}</>
                    : <><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkExplain")}</>}
                </button>
              </div>
            )}
            {row}
            {/* 구간 끝: 아래에 노트(변경 코드 밑) */}
            {endNote?.status === "done" && (
              <div className="my-1 ml-[4.75rem] mr-4 rounded-lg border border-[#3B34E2]/30 bg-[#3B34E2]/5 px-3 py-2 font-sans dark:border-[#8b86f5]/30 dark:bg-[#8b86f5]/10">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[#3B34E2] dark:text-[#8b86f5]"><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkNote")}</div>
                <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-headings:my-1 prose-headings:text-[12px] prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0"><Markdown>{endNote.text ?? ""}</Markdown></div>
              </div>
            )}
            {endNote?.status === "error" && (
              <div className="my-1 ml-[4.75rem] flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={12} stroke={2} aria-hidden />{t("workspace.hunkNoteError")}</div>
            )}
          </Fragment>
        );
      })}
      </div>
      {/* 오른쪽 오버뷰 미니맵 스크롤바 — 트랙 + 변경 마크(초록/빨강) + 잡을 수 있는 뷰포트 썸. 드래그/클릭 이동. */}
      <div ref={rulerRef} onMouseDown={rulerDown} className="absolute inset-y-0 right-0 w-3.5 cursor-pointer border-l border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-800/40">
        {blocks.map((b, k) => (
          <div key={k} className={`pointer-events-none absolute inset-x-0 ${b.add ? "bg-emerald-500" : "bg-rose-500"}`} style={{ top: `${b.top}%`, height: `${Math.max(0.6, b.height)}%`, minHeight: 3 }} />
        ))}
        {/* 뷰포트 썸(지금 보고 있는 구간) — 스크롤·호버 시만(미니맵 마크는 항상). */}
        <div className={`pointer-events-none absolute inset-x-0 rounded border border-zinc-400/60 bg-zinc-400/40 transition-opacity duration-300 dark:border-zinc-500/60 dark:bg-zinc-500/40 ${showRuler ? "opacity-100" : "opacity-0"}`} style={{ top: `${vp.top}%`, height: `${Math.max(6, vp.height)}%`, minHeight: 18 }} />
      </div>
    </div>
  );
}
