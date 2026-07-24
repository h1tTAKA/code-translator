"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconArrowUpRight, IconArrowDownLeft, IconFile, IconSparkles, IconLoader2, IconMessageCircle, IconArrowUp } from "@tabler/icons-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import Markdown from "@/components/learning/Markdown";
import { parseCardSuggestions, stripStreamingCardBlock } from "@/lib/cardSuggestion";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";
import type { RepoGraph } from "@/lib/repo/types";

type StreamEvent =
  | { type: "progress"; line: string }
  | { type: "result"; response: { summary: string } }
  | { type: "error"; message: string };

// 노드 클릭 우측 패널 — 구조(파일·그룹·이웃 in/out) + 온디맨드 LLM 설명(기능·화면·연결·로직·설계의도).
export default function RepoNodePanel({ graph, nodeId, providerId, providerSettings, explanation, onExplained, chat, onChat, onClose, onSelect }: {
  graph: RepoGraph;
  nodeId: string;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  explanation?: string;             // 캐시된 설명(있으면 바로 표시)
  onExplained: (text: string) => void;
  chat?: ChatMessage[];             // 캐시된 챗 스레드
  onChat: (msgs: ChatMessage[]) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const node = graph.nodes.find((n) => n.id === nodeId);
  const [generating, setGenerating] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [input, setInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<string | null>(null); // 파일 소스 1회 읽어 설명·챗 공유
  const asideRef = useRef<HTMLDivElement>(null);
  // 챗룸 게이트 — 기본 닫힘(기존 챗 있으면 열린 채로 시작).
  const [chatOpen, setChatOpen] = useState<boolean>((chat?.length ?? 0) > 0);
  // 첫 메시지 전송 등으로 챗이 생기면 자동으로 열기(마운트 유지 중 prop 갱신 반영).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 챗 발생 시 게이트 오픈 동기화
  useEffect(() => { if ((chat?.length ?? 0) > 0) setChatOpen(true); }, [chat]);
  useEffect(() => () => { abortRef.current?.abort(); chatAbortRef.current?.abort(); }, []);
  // Escape 키 받으려면 패널이 포커스 가능·포커스돼야 함(마운트 시 focus).
  useEffect(() => { asideRef.current?.focus(); }, []);

  // 노드 열릴 때 설명 자동 생성(캐시 없을 때 1회). 패널은 key={nodeId}로 노드마다 remount → 1회 발동.
  // 재클릭/재진입은 explanation 캐시(부모)로 무비용, 노드 전환은 언마운트 abort로 안전.
  useEffect(() => {
    if (!explanation && !generating && streaming == null) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 노드 마운트 1회 자동 생성만
  }, [nodeId]);

  // 파일 소스 읽기(캐시). 실패 시 빈 문자열.
  async function getSource(signal: AbortSignal): Promise<string> {
    if (sourceRef.current != null) return sourceRef.current;
    try {
      const r = await fetch("/api/repo/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: graph.root, file: node?.file }), signal,
      });
      const d = await r.json();
      sourceRef.current = r.ok ? (d.content ?? "") : "";
    } catch { sourceRef.current = ""; }
    return sourceRef.current ?? "";
  }

  // 이웃 — out: 이 파일이 import 하는 것 / in: 이 파일을 import 하는 것.
  const { imports, importedBy } = useMemo(() => {
    const out: string[] = [];
    const inc: string[] = [];
    for (const e of graph.edges) {
      if (e.source === nodeId) out.push(e.target);
      else if (e.target === nodeId) inc.push(e.source);
    }
    return { imports: out, importedBy: inc };
  }, [graph, nodeId]);

  async function generate() {
    if (generating || !node) return;
    setGenerating(true); setStreaming(""); setError(false);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const source = await getSource(ac.signal);
      const ctx = buildCtx(source);
      const ask = "위 파일을 비개발자도 이해하게 설명해줘. ①무슨 기능인지 ②앱 화면의 어느 부분인지(추정) ③어떤 것들과 연결·의존하는지 ④주요 로직 흐름 ⑤왜 이렇게 설계됐는지(추론이면 '추론'이라 표기). 짧은 문단·불릿으로.";
      const thread: ChatMessage[] = [{ role: "user", content: ask }];
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings } }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) { if (!ac.signal.aborted) setError(true); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let ev: StreamEvent;
          try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "progress" && providerId !== "codex-agent" && !ac.signal.aborted) setStreaming(ev.line);
          else if (ev.type === "result") answer = ev.response.summary;
        }
      }
      if (!ac.signal.aborted) {
        const text = parseCardSuggestions(answer || "").text || answer || "(빈 응답)";
        onExplained(text);
      }
    } catch {
      if (!ac.signal.aborted) setError(true);
    } finally {
      if (!ac.signal.aborted) { setGenerating(false); setStreaming(null); }
    }
  }

  // 소스 + 이웃 + (있으면)설명 → 챗/설명 공용 컨텍스트.
  function buildCtx(source: string): string {
    const nbr = (arr: string[]) => arr.map((i) => i.split("/").pop()).join(", ") || "(없음)";
    const exp = explanation ? `\n\n# 이 파일 설명(참고)\n${explanation}` : "";
    return `# 파일: ${node?.file}\n이 파일이 import: ${nbr(imports)}\n이 파일을 import: ${nbr(importedBy)}${exp}\n\n# 소스\n\`\`\`\n${source}\n\`\`\``;
  }

  function submitChat() {
    const text = input.trim();
    if (!text || chatStreaming != null || !node) return;
    setInput("");
    const thread: ChatMessage[] = [...(chat ?? []), { role: "user", content: text }];
    onChat(thread);
    setChatStreaming("");
    const ac = new AbortController();
    chatAbortRef.current = ac;
    (async () => {
      let answer = "";
      try {
        const source = await getSource(ac.signal);
        const res = await fetch("/api/agent/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, request: { code: buildCtx(source), locale, providerId, mode: "chat", messages: thread, providerSettings } }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) { if (!ac.signal.aborted) onChat([...thread, { role: "assistant", content: t("repo.node.chatError") }]); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            let ev: StreamEvent;
            try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
            if (ev.type === "progress" && providerId !== "codex-agent" && !ac.signal.aborted) setChatStreaming(ev.line);
            else if (ev.type === "result") answer = ev.response.summary;
          }
        }
        if (!ac.signal.aborted) onChat([...thread, { role: "assistant", content: parseCardSuggestions(answer || "").text || answer || "(빈 응답)" }]);
      } catch {
        if (!ac.signal.aborted) onChat([...thread, { role: "assistant", content: t("repo.node.chatError") }]);
      } finally {
        if (!ac.signal.aborted) setChatStreaming(null);
      }
    })();
  }

  if (!node) return null;

  const segs = node.file.split("/"); // 폴더 브레드크럼용

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className="flex w-[22rem] shrink-0 flex-col border-l border-zinc-200 bg-white outline-none dark:border-zinc-800 dark:bg-[#111219]"
    >
      <header className="flex items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <IconFile size={16} stroke={2} className="mt-0.5 shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100" title={node.file}>{node.label}</p>
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={node.file}>{node.file}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("repo.node.close")} className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={16} stroke={2} aria-hidden />
        </button>
      </header>

      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {/* 폴더 위치 브레드크럼 — 상위 폴더(흐림) / 파일명(굵게). */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] leading-tight">
            {segs.slice(0, -1).map((s, i) => (
              <span key={i} className="text-zinc-400 dark:text-zinc-500">{s}<span className="px-0.5 text-zinc-300 dark:text-zinc-600">/</span></span>
            ))}
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">{segs[segs.length - 1]}</span>
          </div>
          {node.group && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-zinc-400 dark:text-zinc-500">{t("repo.node.group")}</span>
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{node.group}</span>
            </div>
          )}
          <section className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <IconArrowUpRight size={12} stroke={2.5} aria-hidden /> {t("repo.node.imports")} ({imports.length})
            </h3>
            <NeighborList ids={imports} dir="out" onSelect={onSelect} none={t("repo.node.none")} />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <IconArrowDownLeft size={12} stroke={2.5} aria-hidden /> {t("repo.node.importedBy")} ({importedBy.length})
            </h3>
            <NeighborList ids={importedBy} dir="in" onSelect={onSelect} none={t("repo.node.none")} />
          </section>

          {/* LLM 설명 — 온디맨드. 캐시 있으면 바로, 없으면 버튼. */}
          <section className="flex flex-col gap-2 border-t border-zinc-200/70 pt-4 dark:border-zinc-800/70">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <IconSparkles size={12} stroke={2.5} aria-hidden /> {t("repo.node.explainTitle")}
            </h3>
            {explanation ? (
              <div className="select-text text-[13px] text-zinc-700 dark:text-zinc-200"><Markdown>{explanation}</Markdown></div>
            ) : streaming != null ? (
              <div className="select-text text-[13px] text-zinc-700 dark:text-zinc-200">
                {streaming ? <Markdown>{stripStreamingCardBlock(streaming)}</Markdown> : <span className="inline-flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden />{t("repo.node.explaining")}</span>}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#3B34E2] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]"
                >
                  <IconSparkles size={13} stroke={2} aria-hidden />
                  {t("repo.node.explain")}
                </button>
                {error && <span className="text-[12px] text-rose-500">{t("repo.node.explainError")}</span>}
              </>
            )}
          </section>

          {/* 챗 — 이 파일에 대한 꼬리질문. */}
          <section className="flex flex-col gap-2 border-t border-zinc-200/70 pt-4 dark:border-zinc-800/70">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <IconMessageCircle size={12} stroke={2.5} aria-hidden /> {t("repo.node.chatTitle")}
            </h3>
            {!chatOpen ? (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-semibold text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-[#8b86f5] dark:hover:text-[#8b86f5]"
              >
                <IconMessageCircle size={13} stroke={2} aria-hidden />
                {t("repo.node.openChat")}{chat?.length ? ` (${chat.length})` : ""}
              </button>
            ) : (
              <>
            {(chat?.length || chatStreaming != null) && (
              <div className="flex flex-col gap-2">
                {(chat ?? []).map((m, i) => m.role === "user" ? (
                  <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#3B34E2] px-3 py-1.5 text-[12px] text-white">{m.content}</div>
                ) : (
                  <div key={i} className="max-w-[90%] select-text self-start rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-1.5 text-[12px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"><Markdown>{parseCardSuggestions(m.content).text}</Markdown></div>
                ))}
                {chatStreaming != null && (
                  <div className="max-w-[90%] select-text self-start rounded-2xl rounded-bl-md bg-zinc-100 px-3 py-1.5 text-[12px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {chatStreaming ? <Markdown>{stripStreamingCardBlock(chatStreaming)}</Markdown> : <span className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500"><IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden />{t("repo.node.chatThinking")}</span>}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-end gap-1.5 rounded-xl border border-zinc-200 bg-white p-1 pl-2.5 transition focus-within:border-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-[#8b86f5]">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submitChat(); } }}
                disabled={chatStreaming != null}
                rows={1}
                placeholder={t("repo.node.chatPlaceholder")}
                className="max-h-24 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-[12px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-50 dark:placeholder:text-zinc-500"
              />
              <button type="button" onClick={submitChat} disabled={chatStreaming != null || !input.trim()} aria-label={t("repo.node.chatSend")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#3B34E2] text-white transition hover:bg-[#322bc9] disabled:opacity-40 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
                <IconArrowUp size={15} stroke={2.5} aria-hidden />
              </button>
            </div>
              </>
            )}
          </section>
        </div>
      </div>
    </aside>
  );
}

// 이웃 목록 — 파일명 클릭 시 그 노드로 이동. dir: out=imports / in=importedBy(아이콘 구분).
function NeighborList({ ids, dir, onSelect, none }: { ids: string[]; dir: "out" | "in"; onSelect: (id: string) => void; none: string }) {
  if (ids.length === 0) return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">{none}</p>;
  const Icon = dir === "out" ? IconArrowUpRight : IconArrowDownLeft;
  return (
    <ul className="flex flex-col gap-0.5">
      {ids.map((id) => (
        <li key={id}>
          <button
            type="button"
            onClick={() => onSelect(id)}
            className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-100 hover:text-[#3B34E2] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-[#8b86f5]"
            title={id}
          >
            <Icon size={12} stroke={2} className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
            <span className="truncate">{id.split("/").pop()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
