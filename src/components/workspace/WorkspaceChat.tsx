"use client";
// 워크스페이스 우측 챗룸(#647) — 코딩하다 바로 질문. 기존 ChatRoom UI 재사용, 여기선 messages·LLM 호출만 소유.
// 열린 파일이 있으면 그 소스를 컨텍스트로 실어 "이 파일 왜 이래?"가 통하게 한다.
import { useRef, useState } from "react";
import ChatRoom from "@/components/learning/ChatRoom";
import { parseCardSuggestions } from "@/lib/cardSuggestion";
import { useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@/lib/agent";

type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

export default function WorkspaceChat({ root, openFile, providerId, providerSettings }: {
  root: string;
  openFile: string | null;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
}) {
  const { locale } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const srcCache = useRef<Map<string, string>>(new Map());

  // 열린 파일 소스(캐시) — 챗 컨텍스트.
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

  async function onSend(text: string) {
    if (loading) return;
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

  return (
    <ChatRoom
      messages={messages}
      streaming={streaming}
      isLoading={loading}
      onSend={onSend}
      onClear={messages.length ? () => setMessages([]) : undefined}
    />
  );
}
