"use client";
// 워크스페이스 우측 챗룸(#647, #653) — 코딩하다 바로 질문. 워크스페이스 전용 슬림 UI.
// #653: 단일 스레드 → "무엇에 대한 대화인가"별 키드 세션 맵.
//   repo(기본, 레포 전체) / file:<path>(그 파일) / diff:<hash>:<file>(커밋 변경) / branch:<name>(브랜치 작업).
// 각 세션 = 독립 스레드 + kind별 컨텍스트. localStorage 영속. 상단 탭바로 전환.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconMessageCircle, IconArrowUp, IconLoader2, IconFileCode, IconTrash, IconStack2, IconGitBranch, IconGitCommit, IconX } from "@tabler/icons-react";
import Markdown from "@/components/learning/Markdown";
import { parseCardSuggestions } from "@/lib/cardSuggestion";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";

type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

type SessionKind = "repo" | "file" | "diff" | "branch";
interface Session { key: string; kind: SessionKind; label: string; messages: ChatMessage[]; }

const REPO_KEY = "repo";
const MAX_SESSIONS = 24; // 상한만(골격) — 초과 시 가장 오래된 비활성 세션 정리. 세밀 LRU는 후속.

// 세션 kind별 아이콘 — JSX 직접 반환(렌더 중 컴포넌트 변수 생성 회피: react-hooks/static-components).
function kindGlyph(k: SessionKind, size: number, className?: string) {
  const p = { size, stroke: 2, className, "aria-hidden": true } as const;
  return k === "repo" ? <IconStack2 {...p} /> : k === "branch" ? <IconGitBranch {...p} /> : k === "diff" ? <IconGitCommit {...p} /> : <IconFileCode {...p} />;
}

export default function WorkspaceChat({ root, files, openFile, openDiff, focusedBranch, providerId, providerSettings }: {
  root: string;
  files: string[];
  openFile: string | null;
  openDiff: { hash: string; file: string } | null;
  focusedBranch: string | null;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const store = `nunopi:ws-chat:${root}`;

  const [sessions, setSessions] = useState<Record<string, Session>>({ [REPO_KEY]: { key: REPO_KEY, kind: "repo", label: t("workspace.chatRepo"), messages: [] } });
  const [activeKey, setActiveKey] = useState<string>(REPO_KEY);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const ctxCache = useRef<Map<string, string>>(new Map()); // 세션키별 컨텍스트 캐시(재fetch 회피)
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  const active = sessions[activeKey] ?? sessions[REPO_KEY];
  const messages = active.messages;

  // 루트 바뀌면 저장된 세션 복원(레포별 격리).
  useEffect(() => {
    hydrated.current = false;
    let next: Record<string, Session> = { [REPO_KEY]: { key: REPO_KEY, kind: "repo", label: t("workspace.chatRepo"), messages: [] } };
    let act = REPO_KEY;
    try {
      const raw = localStorage.getItem(store);
      if (raw) {
        const p = JSON.parse(raw) as { sessions?: Record<string, Session>; activeKey?: string };
        if (p.sessions && p.sessions[REPO_KEY]) next = p.sessions;
        if (p.activeKey && next[p.activeKey]) act = p.activeKey;
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 루트 변경 시 세션 복원(1회)
    setSessions(next); setActiveKey(act);
    ctxCache.current.clear();
    hydrated.current = true;
  }, [store, t]);

  // 세션 변경 영속.
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(store, JSON.stringify({ sessions, activeKey })); } catch { /* ignore */ }
  }, [sessions, activeKey, store]);

  // 새 메시지·스트리밍·세션전환 시 하단으로.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, streaming, activeKey]);

  // 세션 ensure + 활성화(중복 방지, 상한 정리).
  function openSession(key: string, kind: SessionKind, label: string) {
    setSessions((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: { key, kind, label, messages: [] } };
      const closable = Object.keys(next).filter((k) => k !== REPO_KEY && k !== key);
      if (closable.length > MAX_SESSIONS - 1) delete next[closable[0]]; // 가장 오래된 것 정리
      return next;
    });
    setActiveKey(key);
  }

  // 컨텍스트 신호 → 해당 세션 ensure+활성. (openFile/openDiff/focusedBranch 변화 감지)
  useEffect(() => {
    if (!openFile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 prop 신호를 세션 상태로 동기화(변화 시)
    openSession(`file:${openFile}`, "file", openFile.split("/").pop() ?? openFile);
  }, [openFile]);
  useEffect(() => {
    if (!openDiff) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 prop 신호를 세션 상태로 동기화(변화 시)
    openSession(`diff:${openDiff.hash}:${openDiff.file}`, "diff", `${openDiff.file.split("/").pop()} @${openDiff.hash.slice(0, 7)}`);
  }, [openDiff]);
  useEffect(() => {
    if (!focusedBranch) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 prop 신호를 세션 상태로 동기화(변화 시)
    openSession(`branch:${focusedBranch}`, "branch", focusedBranch);
  }, [focusedBranch]);

  function closeSession(key: string) {
    setSessions((prev) => { if (key === REPO_KEY) return prev; const n = { ...prev }; delete n[key]; return n; });
    setActiveKey((cur) => cur === key ? REPO_KEY : cur);
  }

  function setMessages(msgs: ChatMessage[]) {
    setSessions((prev) => ({ ...prev, [activeKey]: { ...prev[activeKey], messages: msgs } }));
  }

  // kind별 컨텍스트 빌드(세션키 캐시).
  async function buildContext(s: Session): Promise<string> {
    const cached = ctxCache.current.get(s.key);
    if (cached != null) return cached;
    let ctx = "";
    try {
      if (s.kind === "file") {
        const f = s.key.slice("file:".length);
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file: f }) });
        const d = await r.json();
        const src = r.ok ? String(d.content ?? "") : "";
        ctx = src ? `# 지금 열린 파일: ${f}\n\`\`\`\n${src}\n\`\`\`\n` : "";
      } else if (s.kind === "diff") {
        // 키: diff:<hash>:<file> — hash 뒤 첫 ':' 기준 분리(파일 경로 안전).
        const rest = s.key.slice("diff:".length);
        const ci = rest.indexOf(":");
        const hash = rest.slice(0, ci), file = rest.slice(ci + 1);
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
        const d = await r.json();
        const diff = r.ok && d.ok ? String(d.diff ?? "") : "";
        ctx = diff ? `# 커밋 ${hash.slice(0, 7)}에서 ${file}의 변경(diff, before/after)\n\`\`\`diff\n${diff}\n\`\`\`\n` : "";
      } else if (s.kind === "branch") {
        const branch = s.key.slice("branch:".length);
        const r = await fetch("/api/repo/git-branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, branch }) });
        const d = await r.json();
        if (r.ok && d.ok) {
          const parts = [`# 브랜치: ${branch}`];
          if (d.commits) parts.push(`## 최근 커밋\n${d.commits}`);
          if (d.stat) parts.push(`## ${d.base} 대비 변경 요약\n\`\`\`\n${d.stat}\n\`\`\``);
          ctx = parts.join("\n\n") + "\n";
        }
      } else if (s.kind === "repo") {
        ctx = await repoContext();
      }
    } catch { ctx = ""; }
    ctxCache.current.set(s.key, ctx);
    return ctx;
  }

  // 레포 전체 컨텍스트 — 구조 요약 + package.json/README + 현재 브랜치.
  async function repoContext(): Promise<string> {
    const parts: string[] = [];
    // 폴더별 파일 수 요약(상위 디렉터리 기준).
    const byTop = new Map<string, number>();
    for (const f of files) { const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(root)"; byTop.set(top, (byTop.get(top) ?? 0) + 1); }
    const summary = [...byTop.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}/ (${n})`).join(", ");
    parts.push(`# 레포 구조 (총 ${files.length}개 파일)\n${summary}`);
    // 핵심 파일 소스.
    for (const key of ["package.json", "README.md", "readme.md"]) {
      const f = files.find((x) => x.toLowerCase() === key.toLowerCase());
      if (!f) continue;
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file: f }) });
        const d = await r.json();
        const src = r.ok ? String(d.content ?? "").slice(0, 4000) : "";
        if (src) parts.push(`# ${f}\n\`\`\`\n${src}\n\`\`\``);
      } catch { /* ignore */ }
    }
    // 현재 브랜치(git-log 라우트가 branch 반환).
    try {
      const r = await fetch("/api/repo/git-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (r.ok && d.branch) parts.push(`# 현재 브랜치: ${d.branch}`);
    } catch { /* ignore */ }
    return parts.join("\n\n") + "\n";
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const s = active;
    const thread: ChatMessage[] = [...s.messages, { role: "user", content: text }];
    setMessages(thread);
    setLoading(true); setStreaming("");
    try {
      const ctx = await buildContext(s);
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings } }),
      });
      if (!res.ok || !res.body) { setMessages([...thread, { role: "assistant", content: "(응답 실패)" }]); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "progress" && providerId !== "codex-agent") setStreaming(ev.line);
          else if (ev.type === "result") answer = ev.response.summary;
        }
      }
      const clean = parseCardSuggestions(answer || "").text || answer || "(빈 응답)";
      setMessages([...thread, { role: "assistant", content: clean }]);
    } catch {
      setMessages([...thread, { role: "assistant", content: "(오류)" }]);
    } finally {
      setLoading(false); setStreaming(null);
    }
  }

  // 탭 순서: repo 먼저, 나머지 삽입 순.
  const tabs = useMemo(() => {
    const keys = Object.keys(sessions);
    return [REPO_KEY, ...keys.filter((k) => k !== REPO_KEY)].filter((k) => sessions[k]).map((k) => sessions[k]);
  }, [sessions]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭바 — 열린 세션들 */}
      <div className="nunopi-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
        {tabs.map((s) => {
          const on = s.key === activeKey;
          return (
            <button key={s.key} type="button" onClick={() => setActiveKey(s.key)} title={s.key}
              className={`group inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${on ? "bg-[#3B34E2] text-white dark:bg-[#8b86f5] dark:text-zinc-900" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}>
              {kindGlyph(s.kind, 11, "shrink-0")}
              <span className="max-w-[92px] truncate">{s.label}</span>
              {s.key !== REPO_KEY && (
                <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); closeSession(s.key); }}
                  className={`ml-0.5 shrink-0 rounded ${on ? "hover:bg-white/25" : "hover:bg-zinc-300 dark:hover:bg-zinc-600"}`} aria-label="close session">
                  <IconX size={10} stroke={2.5} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 헤더 — 현재 세션 표시 + 지우기 */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {kindGlyph(active.kind, 14, "shrink-0 text-[#3B34E2] dark:text-[#8b86f5]")}
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200" title={active.key}>{active.label}</span>
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={t("workspace.chatClear")}>
            <IconTrash size={13} stroke={2} aria-hidden />
          </button>
        )}
      </div>

      {/* 메시지 */}
      <div ref={scrollRef} className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-300 dark:text-zinc-600">
            <IconMessageCircle size={24} stroke={1.5} aria-hidden />
            <span className="whitespace-pre-line text-[11px] leading-relaxed">{t("workspace.chatEmpty")}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => m.role === "user" ? (
              <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-[#3B34E2] px-3 py-1.5 text-[12px] leading-relaxed text-white dark:bg-[#8b86f5] dark:text-zinc-900">{m.content}</div>
            ) : (
              <div key={i} className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                <div className="prose prose-sm max-w-none dark:prose-invert"><Markdown>{m.content}</Markdown></div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden />
                <span className="truncate">{streaming || "…"}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <div className="flex items-end gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 focus-within:border-[#3B34E2] dark:border-zinc-700 dark:bg-[#0e0f16] dark:focus-within:border-[#8b86f5]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={1}
            placeholder={t("workspace.chatPlaceholder")}
            className="nunopi-scroll max-h-28 min-h-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button type="button" onClick={() => void send()} disabled={!input.trim() || loading}
            className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#3B34E2] text-white transition hover:bg-[#322bc9] disabled:opacity-40 dark:bg-[#8b86f5] dark:text-zinc-900">
            {loading ? <IconLoader2 size={13} stroke={2.5} className="animate-spin" aria-hidden /> : <IconArrowUp size={14} stroke={2.5} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
