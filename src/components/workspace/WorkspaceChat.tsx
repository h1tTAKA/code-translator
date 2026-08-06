"use client";
// 워크스페이스 우측 챗룸(#647, #653) — 코딩하다 바로 질문. 워크스페이스 전용 슬림 UI.
// #653: 단일 스레드 → "무엇에 대한 대화인가"별 키드 세션 맵.
//   repo(기본, 레포 전체) / file:<path>(그 파일) / diff:<hash>:<file>(커밋 변경) / branch:<name>(브랜치 작업).
// 각 세션 = kind별 컨텍스트 + 그 안에 여러 서브 대화(sub) 스레드. 질문 쌓여도 새 대화로 분리(스크롤 지옥 방지).
// 데이터(sessions)와 열린 탭(openKeys) 분리: 탭 닫아도 대화 보존, 다시 열면 복원. localStorage 영속.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconMessageCircle, IconArrowUp, IconLoader2, IconFileCode, IconFileText, IconEraser, IconStack2, IconGitBranch, IconGitCommit, IconX, IconPlus } from "@tabler/icons-react";
import Markdown from "@/components/learning/Markdown";
import { formatChatAsMarkdown } from "@/components/learning/ChatRoom";
import { parseCardSuggestions, stripStreamingCardBlock } from "@/lib/cardSuggestion";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";

type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

type SessionKind = "repo" | "file" | "diff" | "branch";
interface Sub { id: string; messages: ChatMessage[]; } // 세션 안의 한 대화 스레드
interface Session { key: string; kind: SessionKind; label: string; subs: Sub[]; activeSubId: string; }
// WorkspaceView가 주는 포커스 신호 — n(nonce)로 같은 대상 재클릭도 매번 발화.
export interface ChatFocus { key: string; kind: SessionKind; label: string; n: number; }

const REPO_KEY = "repo";
const MAX_SESSIONS = 40; // 닫힌 세션 포함 저장 상한 — 초과 시 가장 오래된 "닫힌" 세션부터 정리.

const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
const freshSub = (): Sub => ({ id: genId(), messages: [] });
const mkSession = (key: string, kind: SessionKind, label: string): Session => { const s = freshSub(); return { key, kind, label, subs: [s], activeSubId: s.id }; };

// localStorage에서 세션 복원(마이그레이션 포함). SSR/미저장 시 기본(repo 세션 1개).
// 마운트 시 동기 호출 → 하이드레이션 이펙트 레이스(빈 상태 덮어쓰기) 원천 제거.
function loadStore(store: string, repoLabel: string): { sessions: Record<string, Session>; openKeys: string[]; activeKey: string } {
  const fresh = () => ({ sessions: { [REPO_KEY]: mkSession(REPO_KEY, "repo", repoLabel) } as Record<string, Session>, openKeys: [REPO_KEY], activeKey: REPO_KEY });
  if (typeof localStorage === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(store);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as { sessions?: Record<string, Partial<Session> & { messages?: ChatMessage[] }>; openKeys?: string[]; activeKey?: string };
    if (!p.sessions || !p.sessions[REPO_KEY]) return fresh();
    const sessions: Record<string, Session> = {};
    for (const [k, s] of Object.entries(p.sessions)) {
      const subs = Array.isArray(s.subs) && s.subs.length ? s.subs : [{ id: genId(), messages: Array.isArray(s.messages) ? s.messages : [] }];
      sessions[k] = { key: k, kind: (s.kind ?? "file") as SessionKind, label: s.label ?? k, subs, activeSubId: s.activeSubId && subs.some((x) => x.id === s.activeSubId) ? s.activeSubId : subs[0].id };
    }
    let openKeys = Array.isArray(p.openKeys) && p.openKeys.length ? p.openKeys.filter((k) => sessions[k]) : Object.keys(sessions);
    openKeys = [REPO_KEY, ...openKeys.filter((k) => k !== REPO_KEY)]; // repo 항상 맨 앞
    const activeKey = p.activeKey && sessions[p.activeKey] && openKeys.includes(p.activeKey) ? p.activeKey : REPO_KEY;
    return { sessions, openKeys, activeKey };
  } catch { return fresh(); }
}

// 세션 kind별 아이콘 — JSX 직접 반환(렌더 중 컴포넌트 변수 생성 회피: react-hooks/static-components).
function kindGlyph(k: SessionKind, size: number, className?: string) {
  const p = { size, stroke: 2, className, "aria-hidden": true } as const;
  return k === "repo" ? <IconStack2 {...p} /> : k === "branch" ? <IconGitBranch {...p} /> : k === "diff" ? <IconGitCommit {...p} /> : <IconFileCode {...p} />;
}

export default function WorkspaceChat({ root, files, focus, providerId, providerSettings }: {
  root: string;
  files: string[];
  focus: ChatFocus | null;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const store = `nunopi:ws-chat:${root}`;

  // 마운트 시 저장소에서 동기 복원(lazy init) — 새로고침/모드전환/재오픈 즉시 올바른 데이터로 시작.
  const initial = useMemo(() => loadStore(store, t("workspace.chatRepo")), []); // eslint-disable-line react-hooks/exhaustive-deps -- 마운트 1회 복원(store 변경은 아래 이펙트가 처리)
  const [sessions, setSessions] = useState<Record<string, Session>>(initial.sessions);
  const [openKeys, setOpenKeys] = useState<string[]>(initial.openKeys); // 탭바에 보이는 세션들(닫으면 여기서만 빠짐, 데이터는 유지)
  const [activeKey, setActiveKey] = useState<string>(initial.activeKey);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const ctxCache = useRef<Map<string, string>>(new Map()); // 세션키별 컨텍스트 캐시(재fetch 회피)
  const scrollRef = useRef<HTMLDivElement>(null);
  const curStore = useRef(store); // 현재 로드된 store(폴더 변경 감지용)

  const active = sessions[activeKey] ?? sessions[REPO_KEY];
  const activeSub = active.subs.find((s) => s.id === active.activeSubId) ?? active.subs[0];
  const messages = activeSub.messages;

  // 폴더(store) 변경 시에만 재로드. 첫 마운트는 lazy init이 이미 처리했으므로 스킵.
  useEffect(() => {
    if (curStore.current === store) return;
    curStore.current = store;
    const d = loadStore(store, t("workspace.chatRepo"));
    setSessions(d.sessions); setOpenKeys(d.openKeys); setActiveKey(d.activeKey);
    ctxCache.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store 변경만 감지(t는 안정)
  }, [store]);

  // 세션 변경 영속. deps에서 store 제외 — store 바뀐 렌더에 옛 sessions를 새 store 키에 쓰는 오염 방지.
  // (store는 클로저 현재값으로 씀. 첫 실행은 loaded===loaded라 idempotent.)
  useEffect(() => {
    try { localStorage.setItem(store, JSON.stringify({ sessions, openKeys, activeKey })); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터 변경 시에만 저장(store 변경엔 반응 안 함)
  }, [sessions, openKeys, activeKey]);

  // 새 메시지·스트리밍·세션/서브 전환 시 하단으로.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, streaming, activeKey, activeSub.id]);

  // 세션 ensure(기존 데이터 보존) + 탭 열기 + 활성화.
  function openSession(key: string, kind: SessionKind, label: string) {
    const dropped: string[] = [];
    setSessions((prev) => {
      if (prev[key]) return prev; // 이미 있으면 대화 그대로 보존
      const next = { ...prev, [key]: mkSession(key, kind, label) };
      // 상한 정리 — 닫힌 것 먼저, 그래도 넘치면 오래된 열린 것까지(활성·repo·방금 것 제외).
      const closed = Object.keys(next).filter((k) => k !== REPO_KEY && k !== key && k !== activeKey && !openKeys.includes(k));
      const open = Object.keys(next).filter((k) => k !== REPO_KEY && k !== key && k !== activeKey && openKeys.includes(k));
      for (const k of [...closed, ...open]) { if (Object.keys(next).length <= MAX_SESSIONS) break; delete next[k]; dropped.push(k); }
      return next;
    });
    setOpenKeys((prev) => { const p = prev.filter((k) => !dropped.includes(k)); return p.includes(key) ? p : [...p, key]; });
    setActiveKey(key);
  }

  // 포커스 신호(WorkspaceView) → 해당 세션 열기·활성. n(nonce) 덕에 같은 대상 재클릭도 발화.
  useEffect(() => {
    if (!focus) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 클릭 신호를 세션 상태로 동기화
    openSession(focus.key, focus.kind, focus.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus만 감시(openSession 넣으면 매 렌더 재실행)
  }, [focus]);

  // 탭 닫기 — 탭바에서만 제거, 대화 데이터는 sessions에 보존(다시 열면 복원).
  function closeSession(key: string) {
    if (key === REPO_KEY) return;
    setOpenKeys((prev) => prev.filter((k) => k !== key));
    setActiveKey((cur) => cur === key ? REPO_KEY : cur);
  }

  // 특정 세션·서브의 메시지 갱신(키·subId 명시 — send 도중 탭/서브 전환돼도 원래 대화에 기록).
  function writeSub(key: string, subId: string, msgs: ChatMessage[]) {
    setSessions((prev) => {
      const s = prev[key]; if (!s) return prev;
      return { ...prev, [key]: { ...s, subs: s.subs.map((su) => su.id === subId ? { ...su, messages: msgs } : su) } };
    });
  }

  // 서브 대화: 새로 / 전환 / 닫기.
  function newSub() {
    setSessions((prev) => { const s = prev[activeKey]; if (!s) return prev; const su = freshSub(); return { ...prev, [activeKey]: { ...s, subs: [...s.subs, su], activeSubId: su.id } }; });
  }
  function switchSub(id: string) {
    setSessions((prev) => { const s = prev[activeKey]; if (!s) return prev; return { ...prev, [activeKey]: { ...s, activeSubId: id } }; });
  }
  async function closeSub(id: string) {
    // 항상 삭제 확인(실수 방지) — Ask 챗룸과 동일.
    if (!(await confirm({ title: t("workspace.chatDeleteThreadTitle"), message: t("workspace.chatDeleteThread"), confirmText: t("common.delete"), danger: true }))) return;
    setSessions((prev) => {
      const s = prev[activeKey]; if (!s) return prev;
      let subs = s.subs.filter((su) => su.id !== id);
      if (!subs.length) subs = [freshSub()]; // 최소 1개 유지
      const activeSubId = s.activeSubId === id ? subs[subs.length - 1].id : s.activeSubId;
      return { ...prev, [activeKey]: { ...s, subs, activeSubId } };
    });
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
        if (ci < 0) return ""; // 방어: 정상 키는 항상 hash:file
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

  // 현재 대화를 마크다운으로 클립보드 복사(다른 챗룸과 동일).
  async function copyMd() {
    try { await navigator.clipboard.writeText(formatChatAsMarkdown(messages, t)); toast(t("chat.mdCopied")); } catch { /* clipboard 불가 — 무시 */ }
  }
  // 현재 대화 초기화(확인 모달 후). 목적지를 모달 전에 고정(모달 중 탭 전환 대비).
  async function clearThread() {
    const sk = active.key, subId = active.activeSubId;
    if (!(await confirm({ title: t("chat.clear"), message: t("chat.confirmClear"), confirmText: t("chat.clear"), danger: true }))) return;
    writeSub(sk, subId, []);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const s = active;
    const sk = s.key, subId = s.activeSubId; // 이 대화의 목적지 고정(응답 대기 중 전환 대비)
    const thread: ChatMessage[] = [...messages, { role: "user", content: text }];
    writeSub(sk, subId, thread);
    setLoading(true); setStreaming("");
    try {
      const ctx = await buildContext(s);
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings } }),
      });
      if (!res.ok || !res.body) { writeSub(sk, subId, [...thread, { role: "assistant", content: "(응답 실패)" }]); return; }
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
      writeSub(sk, subId, [...thread, { role: "assistant", content: clean }]);
    } catch {
      writeSub(sk, subId, [...thread, { role: "assistant", content: "(오류)" }]);
    } finally {
      setLoading(false); setStreaming(null);
    }
  }

  // 탭 = openKeys 순서(repo 맨 앞).
  const tabs = useMemo(() => openKeys.filter((k) => sessions[k]).map((k) => sessions[k]), [openKeys, sessions]);

  // 서브 대화 제목 — "질문 N"(세션 내 순번). 단순·예측가능.
  const subTitle = (i: number) => `${t("workspace.chatThread")} ${i + 1}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 세션 탭바 — 열린 세션들(repo/file/diff/branch) */}
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

      {/* 헤더 — 현재 세션 표시 */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {kindGlyph(active.kind, 14, "shrink-0 text-[#3B34E2] dark:text-[#8b86f5]")}
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200" title={active.key}>{active.label}</span>
        {messages.length > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={() => void copyMd()} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("chat.copyMd")} aria-label={t("chat.copyMd")}>
              <IconFileText size={13} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={() => void clearThread()} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("chat.clear")} aria-label={t("chat.clear")}>
              <IconEraser size={13} stroke={2} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {/* 서브 대화 탭바 — 이 세션 안의 여러 대화 스레드. 탭은 가로 스크롤, +는 우측 고정 */}
      <div className="flex shrink-0 items-center border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/60 dark:bg-zinc-900/40">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 py-1">
          {active.subs.map((sub, i) => {
            const on = sub.id === active.activeSubId;
            return (
              <button key={sub.id} type="button" onClick={() => switchSub(sub.id)} title={subTitle(i)}
                className={`group inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition ${on ? "bg-white font-semibold text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-white/70 dark:text-zinc-500 dark:hover:bg-zinc-800"}`}>
                <IconMessageCircle size={10} stroke={2} className="shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{subTitle(i)}</span>
                {active.subs.length > 1 && (
                  <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); void closeSub(sub.id); }}
                    className="ml-0.5 shrink-0 rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-600" aria-label="close thread">
                    <IconX size={9} stroke={2.5} aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={newSub} title={t("workspace.chatNewThread")}
          className="shrink-0 border-l border-zinc-200 px-2 py-1.5 text-zinc-400 transition hover:bg-white hover:text-[#3B34E2] dark:border-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-[#8b86f5]">
          <IconPlus size={12} stroke={2.5} aria-hidden />
        </button>
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
            {/* 스트리밍 답변 — 어시스턴트 자리에 Markdown 진행(Ask 챗룸과 통일). 첫 토큰 전엔 "답변 작성 중…". */}
            {streaming != null && (
              <div className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {streaming
                  ? <div className="prose prose-sm max-w-none dark:prose-invert"><Markdown>{stripStreamingCardBlock(streaming)}</Markdown></div>
                  : <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> {t("chat.replying")}</span>}
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
