"use client";
// 실시간 학습 스트림(#855) — MCP 연결 에이전트가 코드그래프 툴을 부를 때마다 "지금 탐색 중인 개념"을
// 실시간 표시(SSE) + 개념마다 "무엇·용어·왜"를 LLM이 짧게 설명(analyze 재사용). 에이전트 작업을 옆에서 학습.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";
import Markdown from "@/components/learning/Markdown";
import { stripCardBlock } from "@/lib/cardSuggestion";

type ConceptKind = "symbol" | "file" | "query" | "repo";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number }
interface Concept { key: string; kind: ConceptKind; target: string; tool: string; count: number; lastTs: number; lastError: boolean }
type Expl = { status: "loading" | "done" | "error"; text?: string };
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap };
const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const ago = (ts: number, now: number) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

// 개념 종류별 "무엇·용어·왜" 설명 프롬프트(초보 눈높이, 코드 없이 개념·이유 위주).
function promptFor(kind: ConceptKind, target: string, repo: string): string {
  const tail = "개발 초보도 이해하게 한국어 2~3문장으로. 무엇인지 + 핵심 용어 + 왜 이렇게 쓰는지(이유). 코드 없이, 장황하지 않게.";
  switch (kind) {
    case "symbol": return `레포 "${repo}"에서 지금 에이전트가 살펴보는 심볼 \`${target}\`이 보통 무슨 역할을 하는 함수/클래스인지 ${tail}`;
    case "file": return `레포 "${repo}"에서 파일 \`${target}\`이 대략 무슨 역할을 하는지 ${tail}`;
    case "query": return `레포 "${repo}"에서 "${target}" 관련 동작·흐름이 보통 어떻게 이뤄지는지 ${tail}`;
    case "repo": return `레포 "${repo}"의 전체 구조를 처음 보는 사람에게 ${tail}`;
  }
}

export default function RepoLearnStream({ root, providerId, providerSettings }: {
  root: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => 0);
  const [expl, setExpl] = useState<Record<string, Expl>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoExplain, setAutoExplain] = useState(true);

  // 비동기 큐에서 최신값 읽기(stale 회피).
  const metaRef = useRef(new Map<string, { kind: ConceptKind; target: string }>());
  const queuedRef = useRef(new Set<string>()); // 이미 생성 시작한 개념(중복 방지)
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const cfgRef = useRef({ providerId, providerSettings, locale, autoExplain });
  useEffect(() => { cfgRef.current = { providerId, providerSettings, locale, autoExplain }; }, [providerId, providerSettings, locale, autoExplain]);

  // 개념 하나 설명 생성(analyze chat 재사용, 스트림 result.summary).
  const explainOne = useCallback(async (key: string) => {
    const meta = metaRef.current.get(key);
    const { providerId: pid, providerSettings: ps, locale: loc } = cfgRef.current;
    if (!meta || !pid) return;
    setExpl((p) => ({ ...p, [key]: { status: "loading" } }));
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: pid, request: { code: `레포: ${basename(root)}`, locale: loc, providerId: pid, mode: "chat", messages: [{ role: "user", content: promptFor(meta.kind, meta.target, basename(root)) }], providerSettings: ps } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; }
      }
      if (streamErr) throw new Error(streamErr);
      setExpl((p) => ({ ...p, [key]: { status: "done", text: stripCardBlock(answer).trim() || "—" } }));
    } catch { setExpl((p) => ({ ...p, [key]: { status: "error" } })); }
  }, [root]);

  // 큐 직렬 처리(동시 1건 — 비용·순서 제어).
  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    while (queueRef.current.length) { const key = queueRef.current.shift()!; await explainOne(key); }
    busyRef.current = false;
  }, [explainOne]);

  const enqueue = useCallback((key: string) => {
    if (queuedRef.current.has(key)) return; // 개념당 1회만
    queuedRef.current.add(key);
    queueRef.current.push(key);
    void pump();
  }, [pump]);

  // SSE 구독 — 툴콜 이벤트 → 개념 목록 + (자동설명 ON·provider 있으면) 새 개념 설명 큐.
  useEffect(() => {
    if (!root) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      const key = `${ev.kind}|${ev.target}`;
      metaRef.current.set(key, { kind: ev.kind, target: ev.target });
      setConcepts((prev) => {
        const found = prev.find((c) => c.key === key);
        const merged: Concept = found
          ? { ...found, tool: ev.tool, count: found.count + 1, lastTs: ev.ts, lastError: ev.isError }
          : { key, kind: ev.kind, target: ev.target, tool: ev.tool, count: 1, lastTs: ev.ts, lastError: ev.isError };
        return [merged, ...prev.filter((c) => c.key !== key)].slice(0, 100);
      });
      const cfg = cfgRef.current;
      if (cfg.autoExplain && cfg.providerId) enqueue(key); // dedup은 enqueue서
    };
    return () => es.close();
  }, [root, enqueue]);

  useEffect(() => {
    if (!concepts.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 상대시간 초기 스냅(이후 1s 틱)
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [concepts.length]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else { n.add(key); if (!queuedRef.current.has(key) && cfgRef.current.providerId) enqueue(key); } return n; }); // 자동설명 OFF여도 펼치면 생성
  }, [enqueue]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <IconActivity size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("learn.title")}</span>
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400" title={t("learn.autoExplain")}>
          <input type="checkbox" checked={autoExplain} onChange={(e) => setAutoExplain(e.target.checked)} /> {t("learn.autoExplain")}
        </label>
        <span className={`flex items-center gap-1 text-[10px] ${live ? "text-emerald-500" : "text-zinc-400 dark:text-zinc-500"}`}>
          <IconPointFilled size={10} stroke={2} aria-hidden /> {live ? t("learn.live") : t("learn.idle")}
        </span>
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {!concepts.length ? (
          <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {concepts.map((c) => {
              const Icon = KIND_ICON[c.kind];
              const e = expl[c.key];
              const open = expanded.has(c.key);
              return (
                <li key={c.key} className="rounded-md border border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-800/30">
                  <button type="button" onClick={() => toggle(c.key)} className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left">
                    <Icon size={14} stroke={2} className={`mt-0.5 shrink-0 ${c.lastError ? "text-rose-400" : "text-mustard-600 dark:text-mustard-400"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{c.target}</span>
                      <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{c.tool.replace(/^katchup_/, "")} · {ago(c.lastTs, now || c.lastTs)}{c.count > 1 ? ` · ×${c.count}` : ""}</span>
                    </span>
                    {e?.status === "loading" ? <IconLoader2 size={12} stroke={2} className="mt-0.5 shrink-0 animate-spin text-zinc-400" aria-hidden />
                      : <IconChevronDown size={13} stroke={2} className={`mt-0.5 shrink-0 text-zinc-400 transition ${open ? "" : "-rotate-90"}`} aria-hidden />}
                  </button>
                  {open && (
                    <div className="border-t border-zinc-200/70 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {e?.status === "done" ? <Markdown>{e.text ?? ""}</Markdown>
                        : e?.status === "error" ? <span className="text-[10px] text-rose-500">{t("learn.explainError")}</span>
                        : <span className="flex items-center gap-1.5 text-[10px] text-zinc-400"><IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> {t("learn.explaining")}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
