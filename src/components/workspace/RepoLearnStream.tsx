"use client";
// 실시간 학습 스트림(#855·#857) — MCP 연결 에이전트가 뭘 하든(그래프 탐색+파일 편집) 실시간 관찰(SSE) +
// 등장한 "개념"을 중복 없이 1회씩 설명하고, 이해에 필요한 "용어"를 별도 용어집으로 누적. 반복 없이 정리.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled, IconLoader2, IconPencil, IconChevronDown, IconBook2 } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";
import Markdown from "@/components/learning/Markdown";
import { stripCardBlock } from "@/lib/cardSuggestion";

type ConceptKind = "symbol" | "file" | "query" | "repo" | "edit";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number }
interface Concept { key: string; kind: ConceptKind; target: string; tool: string; status: "idle" | "loading" | "done" | "error"; expl?: string; ts: number }
interface Term { term: string; def: string }
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap, edit: IconPencil };
const KIND_VERB: Record<ConceptKind, string> = { symbol: "심볼", file: "파일", query: "주제", repo: "레포 구조", edit: "편집 중인 파일" };
const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const ago = (ts: number, now: number) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
const cKey = (root: string) => `nunopi:ws:${root}:learn-concepts`;
const gKey = (root: string) => `nunopi:ws:${root}:learn-terms`;
function load<T>(key: string): T[] { try { const r = typeof localStorage !== "undefined" && localStorage.getItem(key); return r ? (JSON.parse(r) as T[]) : []; } catch { return []; } }

// 개념 1개 설명 프롬프트 — 설명 2문장 + [용어] term :: 뜻. 카드·JSON·코드 금지.
function conceptPrompt(repo: string, kind: ConceptKind, target: string): string {
  return `레포 "${repo}"에서 AI 코딩 에이전트가 지금 ${KIND_VERB[kind]} "${target}"을(를) 다루고 있어.\n`
    + `이게 뭐고 에이전트가 왜 이걸 보는지 개발 초보에게 자연스러운 한국어 2문장으로.\n`
    + `그 다음 줄에 "[용어]"만 쓰고, 이 설명을 이해하는 데 필요한 핵심 용어 2~3개를 "용어 :: 한 줄 뜻" 형식으로 한 줄씩.\n`
    + `코드·카드·JSON·메타 발언 금지. 설명은 흐르는 문장으로(사전식 나열 말고).`;
}

// 응답 → {설명, 용어[]}. "[용어]" 기준 분리, 카드/펜스 제거.
function parseConcept(raw: string): { expl: string; terms: Term[] } {
  let s = stripCardBlock(raw);
  const cardCut = s.search(/```|nunopi-cards|(^|\n)\s*\[\s*\{\s*"(term|word|title)"/i);
  if (cardCut >= 0) s = s.slice(0, cardCut);
  // "[용어]" 마커(앞 개행 없어도) 기준 분리 — 앞=설명, 뒤=용어 목록.
  const m = s.split(/\[\s*용어\s*\]\s*/i);
  const expl = (m[0] ?? "").trim();
  const terms: Term[] = [];
  if (m[1]) for (const line of m.slice(1).join("\n").split("\n")) { // 용어는 한 줄에 하나(term :: 뜻)
    const t = line.replace(/^[-*•\s]+/, "").split(/\s*::\s*/);
    if (t.length >= 2 && t[0].trim() && t.slice(1).join("::").trim()) terms.push({ term: t[0].trim(), def: t.slice(1).join("::").trim() });
  }
  return { expl: expl || "—", terms };
}

export default function RepoLearnStream({ root, providerId, providerSettings }: {
  root: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [concepts, setConcepts] = useState<Concept[]>(() => load<Concept>(cKey(root)).filter((c) => c.status === "done"));
  const [terms, setTerms] = useState<Term[]>(() => load<Term>(gKey(root)));
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => 0);
  const [autoExplain, setAutoExplain] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);

  const seenRef = useRef(new Set(concepts.map((c) => c.key)));       // 이미 설명한 개념(dedup)
  const termSetRef = useRef(new Set(terms.map((x) => x.term.toLowerCase()))); // 용어 dedup
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const metaRef = useRef(new Map<string, { kind: ConceptKind; target: string }>());
  const cfgRef = useRef({ providerId, providerSettings, locale, autoExplain });
  useEffect(() => { cfgRef.current = { providerId, providerSettings, locale, autoExplain }; }, [providerId, providerSettings, locale, autoExplain]);

  const explainOne = useCallback(async (key: string) => {
    const meta = metaRef.current.get(key); const { providerId: pid, providerSettings: ps, locale: loc } = cfgRef.current;
    if (!meta || !pid) return;
    setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "loading" } : c)));
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: pid, request: { code: `레포: ${basename(root)}`, locale: loc, providerId: pid, mode: "chat", messages: [{ role: "user", content: conceptPrompt(basename(root), meta.kind, meta.target) }], providerSettings: ps } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? ""; for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; } }
      if (streamErr) throw new Error(streamErr);
      const { expl, terms: newTerms } = parseConcept(answer);
      setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "done", expl } : c)));
      if (newTerms.length) setTerms((prev) => { const add = newTerms.filter((x) => { const lk = x.term.toLowerCase(); if (termSetRef.current.has(lk)) return false; termSetRef.current.add(lk); return true; }); return add.length ? [...add, ...prev].slice(0, 80) : prev; });
    } catch { setConcepts((p) => p.map((c) => (c.key === key ? { ...c, status: "error" } : c))); }
  }, [root]);

  const pump = useCallback(async () => {
    if (busyRef.current) return; busyRef.current = true;
    while (queueRef.current.length) { const key = queueRef.current.shift()!; await explainOne(key); }
    busyRef.current = false;
  }, [explainOne]);

  const enqueue = useCallback((key: string) => { if (seenRef.current.has(key)) return; seenRef.current.add(key); queueRef.current.push(key); void pump(); }, [pump]);

  // SSE — 이벤트 → 개념 upsert(중복은 ts/tool만 갱신) + 새 개념이면 설명 큐.
  useEffect(() => {
    if (!root) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    es.onopen = () => setLive(true); es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      const key = `${ev.kind}|${ev.target}`;
      metaRef.current.set(key, { kind: ev.kind, target: ev.target });
      setConcepts((prev) => { const found = prev.find((c) => c.key === key); if (found) return [{ ...found, tool: ev.tool, ts: ev.ts }, ...prev.filter((c) => c.key !== key)]; return [{ key, kind: ev.kind, target: ev.target, tool: ev.tool, status: "idle" as const, ts: ev.ts }, ...prev].slice(0, 80); });
      const cfg = cfgRef.current; if (cfg.autoExplain && cfg.providerId) enqueue(key);
    };
    return () => es.close();
  }, [root, enqueue]);

  // 영구보존 — done 개념 + 용어집.
  useEffect(() => { try { if (typeof localStorage !== "undefined") localStorage.setItem(cKey(root), JSON.stringify(concepts.filter((c) => c.status === "done").slice(0, 60))); } catch { /* 무시 */ } }, [concepts, root]);
  useEffect(() => { try { if (typeof localStorage !== "undefined") localStorage.setItem(gKey(root), JSON.stringify(terms.slice(0, 80))); } catch { /* 무시 */ } }, [terms, root]);

  useEffect(() => {
    if (!concepts.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 상대시간 초기 스냅
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id);
  }, [concepts.length]);

  const toggleExpand = useCallback((key: string) => { if (!seenRef.current.has(key) && cfgRef.current.providerId) enqueue(key); }, [enqueue]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <IconActivity size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("learn.title")}</span>
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400" title={t("learn.autoExplain")}>
          <input type="checkbox" checked={autoExplain} onChange={(e) => setAutoExplain(e.target.checked)} /> {t("learn.autoExplain")}
        </label>
        <span className={`flex items-center gap-1 text-[10px] ${live ? "text-emerald-500" : "text-zinc-400 dark:text-zinc-500"}`}><IconPointFilled size={10} stroke={2} aria-hidden /> {live ? t("learn.live") : t("learn.idle")}</span>
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {!concepts.length && !terms.length ? (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.empty")}</p>
        ) : (
          <>
            {/* 용어집 — 이해에 필요한 용어 누적(중복 없음) */}
            {terms.length > 0 && (
              <div className="border-b border-zinc-100 dark:border-zinc-800/70">
                <button type="button" onClick={() => setTermsOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
                  <IconBook2 size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                  <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{t("learn.terms")} ({terms.length})</span>
                  <IconChevronDown size={13} stroke={2} className={`ml-auto shrink-0 text-zinc-400 transition ${termsOpen ? "" : "-rotate-90"}`} aria-hidden />
                </button>
                {termsOpen && <ul className="flex flex-col gap-1 px-3 pb-2.5">
                  {terms.map((x) => (<li key={x.term} className="text-[11px] leading-snug"><span className="font-semibold text-zinc-700 dark:text-zinc-200">{x.term}</span> <span className="text-zinc-500 dark:text-zinc-400">— {x.def}</span></li>))}
                </ul>}
              </div>
            )}
            {/* 개념 — 등장한 개념 1회씩(중복 없음), 최근 먼저 */}
            <ul className="flex flex-col gap-2 p-2.5">
              {concepts.map((c) => { const Icon = KIND_ICON[c.kind]; return (
                <li key={c.key} className="rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <button type="button" onClick={() => toggleExpand(c.key)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
                    <Icon size={14} stroke={2} className="mt-0.5 shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{c.target}</span>
                      <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{c.tool.replace(/^katchup_/, "")} · {ago(c.ts, now || c.ts)}</span>
                    </span>
                    {c.status === "loading" && <IconLoader2 size={12} stroke={2} className="mt-0.5 shrink-0 animate-spin text-zinc-400" aria-hidden />}
                  </button>
                  {(c.status === "done" || c.status === "error") && (
                    <div className="border-t border-zinc-200/70 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {c.status === "done" ? <Markdown>{c.expl ?? ""}</Markdown> : <span className="text-[10px] text-rose-500">{t("learn.explainError")}</span>}
                    </div>
                  )}
                </li>
              ); })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
