"use client";
// 실시간 학습 스트림(#855) — MCP 연결 에이전트가 코드그래프 툴을 부를 때마다 "지금 탐색 중인 개념"을
// 실시간 표시(SSE). 커밋2는 활동 목록만(LLM 없음). 개념 자동 설명은 커밋3.
import { useEffect, useState } from "react";
import { IconCode, IconFile, IconSearch, IconSitemap, IconActivity, IconPointFilled } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

type ConceptKind = "symbol" | "file" | "query" | "repo";
interface ActivityEvent { root: string; tool: string; kind: ConceptKind; target: string; isError: boolean; ts: number }
interface Concept { key: string; kind: ConceptKind; target: string; tool: string; count: number; lastTs: number; lastError: boolean }

const KIND_ICON: Record<ConceptKind, typeof IconCode> = { symbol: IconCode, file: IconFile, query: IconSearch, repo: IconSitemap };
const ago = (ts: number, now: number) => { const s = Math.max(0, Math.round((now - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

export default function RepoLearnStream({ root }: {
  root: string;
  providerId?: AgentProviderKind;       // 커밋3(설명 생성)서 사용
  providerSettings?: ProviderSettings;
}) {
  const t = useT();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => 0); // 상대시간 갱신용(초기 0 → 마운트 후 tick)

  // SSE 구독 — 툴콜 이벤트 → 개념 목록(중복 병합, 최근순).
  useEffect(() => {
    if (!root) return;
    const es = new EventSource(`/api/repo/mcp/activity/stream?root=${encodeURIComponent(root)}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // 브라우저가 자동 재연결
    es.onmessage = (m) => {
      let ev: ActivityEvent; try { ev = JSON.parse(m.data) as ActivityEvent; } catch { return; }
      if (!ev?.target) return;
      setConcepts((prev) => {
        const key = `${ev.kind}|${ev.target}`;
        const found = prev.find((c) => c.key === key);
        const merged: Concept = found
          ? { ...found, tool: ev.tool, count: found.count + 1, lastTs: ev.ts, lastError: ev.isError }
          : { key, kind: ev.kind, target: ev.target, tool: ev.tool, count: 1, lastTs: ev.ts, lastError: ev.isError };
        return [merged, ...prev.filter((c) => c.key !== key)].slice(0, 100); // 최근 100 개념
      });
    };
    return () => es.close();
  }, [root]);

  // 상대시간 1s 틱(개념 있을 때만).
  useEffect(() => {
    if (!concepts.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 상대시간 초기 스냅(이후 1s 틱)
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [concepts.length]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <IconActivity size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("learn.title")}</span>
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
              return (
                <li key={c.key} className="flex items-start gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/30">
                  <Icon size={14} stroke={2} className={`mt-0.5 shrink-0 ${c.lastError ? "text-rose-400" : "text-mustard-600 dark:text-mustard-400"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{c.target}</span>
                    <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{c.tool.replace(/^katchup_/, "")} · {ago(c.lastTs, now || c.lastTs)} {c.count > 1 ? `· ×${c.count}` : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
