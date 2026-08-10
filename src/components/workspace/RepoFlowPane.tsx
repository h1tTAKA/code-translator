"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconSitemap, IconX, IconLoader2, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

// 기능별 아키텍처 플로우(#743) — Manyfast 유저플로우식: 레이어=컬럼(좌→우), 알약 노드, 노드→코드 점프.
type FlowNode = { name: string; file?: string; line?: number; role?: string };
type FlowSection = { layer: string; nodes: FlowNode[] };
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

// 튜터가 내는 "레이어 | 이름 | 파일:라인 | 역할" 라인들을 레이어별 섹션으로. JSON은 안 옴(튜터 페르소나).
function parseFlow(text: string): FlowSection[] {
  const order: string[] = [];
  const byLayer = new Map<string, FlowNode[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!line.includes("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const layer = parts[0];
    const name = parts[1];
    // 3번째 칸이 파일:라인처럼 보이면 파일 노드, 아니면 역할로.
    let file: string | undefined, lineNo: number | undefined, role: string | undefined;
    const f = parts[2];
    if (f && /[/.]/.test(f) && !/\s/.test(f.replace(/:\d+$/, ""))) {
      const m = f.match(/^(.*?):(\d+)$/);
      file = (m ? m[1] : f).replace(/^\.?\//, "");
      lineNo = m ? Number(m[2]) : undefined;
      role = parts[3] || undefined;
    } else {
      role = parts.slice(2).filter(Boolean).join(" · ") || undefined;
    }
    if (!byLayer.has(layer)) { byLayer.set(layer, []); order.push(layer); }
    byLayer.get(layer)!.push({ name, file, line: lineNo, role });
  }
  return order.map((layer) => ({ layer, nodes: byLayer.get(layer)! }));
}

export default function RepoFlowPane({ feature, root, providerId, providerSettings, onOpenFile, onClose }: {
  feature?: string | null;
  root?: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onOpenFile?: (file: string, line?: number) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [sections, setSections] = useState<FlowSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0); // 최신 요청만 반영(빠른 feature 전환 경합 방지)

  const load = useCallback(async () => {
    if (!feature || !root || !providerId || !providerSettings) return;
    const my = ++reqRef.current;
    setLoading(true); setErr(null); setSections(null);
    try {
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = basename(root);
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}`;
      const prompt = `레포 "${name}"에서 "${feature}" 기능의 아키텍처 흐름을 레이어별로 정리해줘. 진입(UI/route) → 처리(IPC/handler) → 서비스/로직 → 데이터/외부 순. 인사·서론·다른 설명 없이 **각 노드를 한 줄씩**, 아래 형식으로만:\n레이어 | 표시이름 | 파일경로:라인 | 한줄역할\n(파일경로는 위 목록의 실제 경로. 라인 모르면 파일만. 예: 진입·UI | UsageMonitor | src/components/workspace/UsageMonitor.tsx:70 | 호버 시 팝오버)`;
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
      });
      if (!res.ok || !res.body) { if (my === reqRef.current) setErr(`HTTP ${res.status}`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; }
      }
      if (my !== reqRef.current) return; // 더 최신 요청이 진행 중 → 폐기
      if (streamErr) { setErr(streamErr); return; }
      const parsed = parseFlow(answer);
      if (!parsed.length) { setErr(`no flow — ${answer.slice(0, 140)}`); return; }
      setSections(parsed);
    } catch (e) {
      if (my === reqRef.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, [feature, root, providerId, providerSettings, locale]);

  // feature 바뀌면 자동 로드.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 로드(내부 setState는 이펙트 동기 실행 아님)
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0b0c12]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconSitemap size={14} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{feature || t("flow.title")}</span>
        {feature && (
          <button type="button" onClick={() => void load()} disabled={loading} title={t("usage.refresh")} aria-label={t("usage.refresh")}
            className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconRefresh size={13} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")}
            className={`${feature ? "" : "ml-auto "}shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}>
            <IconX size={14} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-auto p-4">
        {!feature ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-zinc-400 dark:text-zinc-500">{t("flow.pickFeature")}</div>
        ) : loading && !sections ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /> {t("flow.loading")}</div>
        ) : err ? (
          <div className="flex flex-col gap-1"><p className="text-[12px] text-rose-500">{t("flow.error")}</p><p className="break-words text-[10px] text-zinc-400 dark:text-zinc-500">{err}</p></div>
        ) : sections ? (
          <div className="flex min-w-max items-stretch gap-1">
            {sections.map((s, i) => (
              <div key={s.layer + i} className="flex items-stretch gap-1">
                <div className="flex w-52 shrink-0 flex-col gap-1.5">
                  <div className="border-b border-dashed border-zinc-300 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">{s.layer}</div>
                  {s.nodes.map((n, j) => (
                    <button key={j} type="button" disabled={!n.file} onClick={() => n.file && onOpenFile?.(n.file, n.line)}
                      className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition ${n.file ? "cursor-pointer border-zinc-200 bg-zinc-50 hover:border-[#3B34E2] hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/60 dark:hover:border-[#8b86f5] dark:hover:bg-zinc-800" : "cursor-default border-transparent bg-zinc-50/50 dark:bg-zinc-800/30"}`}>
                      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{n.name}</span>
                      {n.file && <span className="font-mono text-[9px] text-[#3B34E2] dark:text-[#8b86f5]">{basename(n.file)}{n.line ? `:${n.line}` : ""}</span>}
                      {n.role && <span className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{n.role}</span>}
                    </button>
                  ))}
                </div>
                {i < sections.length - 1 && (
                  <div className="flex items-center px-0.5 text-zinc-300 dark:text-zinc-600"><IconChevronRight size={16} stroke={2} aria-hidden /></div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
