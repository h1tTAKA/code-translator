"use client";
// 실시간 학습 스트림(#855) — MCP 연결 에이전트가 코드그래프 툴을 부르는 흐름을 실시간 관찰(SSE) +
// 그 "작업 흐름"을 자연스러운 산문으로 해설(개념·용어·왜). 툴콜 하나씩 사전식이 아니라, 잠깐 조용해지면
// 그동안의 툴콜 묶음을 한 문단으로 해설해 라이브 코멘터리처럼 쌓임.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled, IconLoader2 } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";
import Markdown from "@/components/learning/Markdown";
import { stripCardBlock } from "@/lib/cardSuggestion";

type ConceptKind = "symbol" | "file" | "query" | "repo";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number }
interface Chapter { id: number; status: "loading" | "done" | "error"; text?: string; ts: number }
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap };
const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const ago = (ts: number, now: number) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
const QUIET_MS = 1800;   // 이만큼 조용하면 그동안 활동을 한 챕터로 해설(짧고 자주)
const MAX_BATCH = 8;     // 한 챕터에 담을 최근 툴콜 수 상한

// 활동 묶음 → "흐름 해설" 프롬프트. 첫 줄 굵은 헤드라인 + 짧은 본문(스캔 쉽게, 사전식 금지).
function narrativePrompt(repo: string, lines: string[]): string {
  return `한 AI 코딩 에이전트가 방금 레포 "${repo}"에서 코드그래프를 아래 순서로 탐색했어:\n${lines.join("\n")}\n\n`
    + `이걸 보고 초보가 옆에서 이해하게 아래 형식으로:\n`
    + `- 첫 줄: 지금 에이전트가 뭐 하는지 한 줄 요약을 굵게(**…**, 10단어 이내).\n`
    + `- 빈 줄 후: 왜 이렇게 하는지 + 핵심 개념/용어를 2~3문장 자연스러운 한국어 산문으로.\n`
    + `소제목·불릿·코드 금지. 사전식 나열("A는 …, B는 …") 말고 흐르는 이야기로. 짧게. `
    + `설명 텍스트만 출력하고, 카드·JSON·"Wait"·다른 메타 발언은 절대 넣지 마.`;
}

// analyze 응답서 해설만 남기기 — 카드 펜스/raw 카드 JSON([{"term"…])/코드펜스 이후 잘라내고 정리.
function cleanNarrative(raw: string): string {
  let s = stripCardBlock(raw);
  // 코드펜스/카드 마커/줄머리 raw 카드 JSON 이후 절단(프로즈 중간 오탐 방지 위해 카드 JSON은 줄머리 앵커).
  const cut = s.search(/```|nunopi-cards|(^|\n)\s*\[\s*\{\s*"(term|word|title)"/i);
  if (cut >= 0) s = s.slice(0, cut);
  return s.trim();
}

export default function RepoLearnStream({ root, providerId, providerSettings }: {
  root: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => 0);
  const [autoExplain, setAutoExplain] = useState(true);

  const eventsRef = useRef<ActivityEvent[]>([]);   // 전체 이벤트(배치 계산, stale 회피)
  const lastIdxRef = useRef(0);                      // 마지막 해설한 이벤트 인덱스
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const chapIdRef = useRef(0);
  const cfgRef = useRef({ providerId, providerSettings, locale, autoExplain });
  useEffect(() => { cfgRef.current = { providerId, providerSettings, locale, autoExplain }; }, [providerId, providerSettings, locale, autoExplain]);

  // 새 이벤트 이후 조용해지면 그동안 묶음을 한 챕터로 해설(직렬 1건).
  // 단일 타이머 예약(항상 이전 것 정리 → 중복 타이머 누수 방지, cavecrew).
  const schedule = useCallback((fn: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, QUIET_MS);
  }, []);

  const flush = useCallback(async () => {
    const { providerId: pid, providerSettings: ps, locale: loc, autoExplain: auto } = cfgRef.current;
    if (busyRef.current) { schedule(() => void flush()); return; } // 진행 중이면 뒤로(단일 타이머)
    if (!auto || !pid) return;
    const all = eventsRef.current;
    const batch = all.slice(lastIdxRef.current);
    if (!batch.length) return;
    lastIdxRef.current = all.length;
    const lines = batch.slice(-MAX_BATCH).map((e) => `- ${e.tool.replace(/^katchup_/, "")}: ${e.target}${e.isError ? " (실패)" : ""}`);
    const id = ++chapIdRef.current;
    setChapters((p) => [{ id, status: "loading" as const, ts: Date.now() }, ...p].slice(0, 40));
    busyRef.current = true;
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: pid, request: { code: `레포: ${basename(root)}`, locale: loc, providerId: pid, mode: "chat", messages: [{ role: "user", content: narrativePrompt(basename(root), lines) }], providerSettings: ps } }),
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
      const text = cleanNarrative(answer) || "—";
      setChapters((p) => p.map((c) => (c.id === id ? { ...c, status: "done", text } : c)));
    } catch { setChapters((p) => p.map((c) => (c.id === id ? { ...c, status: "error" } : c))); }
    finally { busyRef.current = false; if (eventsRef.current.length > lastIdxRef.current) schedule(() => void flush()); } // 그새 쌓였으면 이어서(단일 타이머)
  }, [root, schedule]);

  // SSE 구독 — 이벤트 수집 + debounce로 흐름 해설 예약.
  useEffect(() => {
    if (!root) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      eventsRef.current = [...eventsRef.current, ev].slice(-200);
      setEvents(eventsRef.current);
      schedule(() => void flush()); // 조용해지면 해설(단일 타이머)
    };
    return () => { es.close(); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [root, flush, schedule]);

  useEffect(() => {
    if (!events.length && !chapters.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 상대시간 초기 스냅(이후 1s 틱)
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [events.length, chapters.length]);

  const recentEvents = events.slice(-8).reverse(); // 최근 활동(꼬리) 타임라인

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
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {!events.length ? (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("learn.empty")}</p>
        ) : (
          <>
            {/* 흐름 해설(산문 챕터, 최신 먼저) */}
            <div className="flex flex-col gap-2 p-2.5">
              {chapters.map((c) => (
                <div key={c.id} className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
                  <div className="mb-1 text-[9px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{ago(c.ts, now || c.ts)} ago</div>
                  {c.status === "done" ? <Markdown>{c.text ?? ""}</Markdown>
                    : c.status === "error" ? <span className="text-[10px] text-rose-500">{t("learn.explainError")}</span>
                    : <span className="flex items-center gap-1.5 text-[10px] text-zinc-400"><IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> {t("learn.explaining")}</span>}
                </div>
              ))}
            </div>
            {/* 최근 활동 타임라인(꼬리) — 원자료 참고용 */}
            <div className="border-t border-zinc-100 px-2.5 py-2 dark:border-zinc-800/70">
              <p className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("learn.recent")}</p>
              <ul className="flex flex-col gap-0.5">
                {recentEvents.map((e, i) => { const Icon = KIND_ICON[e.kind]; return (
                  <li key={`${e.ts}-${i}`} className="flex items-center gap-1.5 px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <Icon size={11} stroke={2} className={`shrink-0 ${e.isError ? "text-rose-400" : "text-zinc-400"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{e.target}</span>
                    <span className="shrink-0 text-zinc-400 dark:text-zinc-600">{e.tool.replace(/^katchup_/, "")} · {ago(e.ts, now || e.ts)}</span>
                  </li>
                ); })}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
