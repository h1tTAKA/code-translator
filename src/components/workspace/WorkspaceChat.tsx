"use client";
// 워크스페이스 우측 챗룸(#647) — 코딩하다 바로 질문. 워크스페이스 전용 슬림 UI(코딩 어시스턴트 느낌).
// 열린 파일이 있으면 그 소스를 컨텍스트로 실어 "이 파일 왜 이래?"가 통하게 한다.
import { useEffect, useRef, useState } from "react";
import { IconMessageCircle, IconArrowUp, IconLoader2, IconFileCode, IconTrash } from "@tabler/icons-react";
import Markdown from "@/components/learning/Markdown";
import { parseCardSuggestions } from "@/lib/cardSuggestion";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";

type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

export default function WorkspaceChat({ root, openFile, providerId, providerSettings }: {
  root: string;
  openFile: string | null;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const srcCache = useRef<Map<string, string>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지·스트리밍 시 하단으로.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, streaming]);

  async function fileContext(): Promise<string> {
    const f = openFile;
    if (!f) return "";
    let src = srcCache.current.get(f);
    if (src == null) {
      try {
        const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file: f }) });
        const d = await r.json();
        src = r.ok ? String(d.content ?? "") : "";
      } catch { src = ""; }
      srcCache.current.set(f, src ?? "");
    }
    return src ? `# 지금 열린 파일: ${f}\n\`\`\`\n${src}\n\`\`\`\n` : "";
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const thread: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(thread);
    setLoading(true); setStreaming("");
    try {
      const ctx = await fileContext();
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

  const fileName = openFile ? openFile.split("/").pop() : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 — 챗 + 컨텍스트 칩(열린 파일) */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconMessageCircle size={14} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("workspace.chat")}</span>
        {fileName && (
          <span className="ml-1 inline-flex min-w-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={openFile ?? undefined}>
            <IconFileCode size={10} stroke={2} className="shrink-0" aria-hidden /><span className="truncate">{fileName}</span>
          </span>
        )}
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
