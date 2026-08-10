"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconSitemap, IconX, IconLoader2, IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

// 기능별 아키텍처 플로우(#743) — Manyfast 유저플로우식: 레이어=밴드(위→아래), 알약 노드, 노드→코드 점프.
// next(다음 노드)를 받아 SVG 곡선으로 연결해 흐름을 직관적으로.
type FlowNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
type FlowSection = { layer: string; nodes: FlowNode[] };
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };
type Line = { key: string; x1: number; y1: number; x2: number; y2: number };

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const nk = (s: string) => s.trim().toLowerCase(); // 노드 이름 정규화 키(엣지 매칭용)

// 튜터가 내는 "레이어 | 이름 | 파일:라인 | 역할 | →다음노드" 라인을 섹션으로. JSON 안 옴(튜터 페르소나).
function parseFlow(text: string): FlowSection[] {
  const order: string[] = [];
  const byLayer = new Map<string, FlowNode[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!line.includes("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const layer = parts[0], name = parts[1];
    let file: string | undefined, lineNo: number | undefined, role: string | undefined, next: string[] | undefined;
    // 3번째 칸부터 순서 무관하게: 화살표=다음노드, 파일처럼 생김=파일:라인, 나머지=역할.
    for (const p of parts.slice(2)) {
      if (!p) continue;
      const arrow = p.match(/^(?:→|->|=>|다음\s*[:：]?)\s*(.+)$/);
      if (arrow) { next = arrow[1].split(/\s*[,，/、]\s*/).map((x) => x.trim().replace(/^[→>\-\s]+/, "")).filter(Boolean); continue; }
      if (!file && /[/.]/.test(p) && !/\s/.test(p.replace(/:\d+$/, ""))) {
        const m = p.match(/^(.*?):(\d+)$/);
        file = (m ? m[1] : p).replace(/^\.?\//, ""); lineNo = m ? Number(m[2]) : undefined; continue;
      }
      if (!role) role = p;
    }
    if (!byLayer.has(layer)) { byLayer.set(layer, []); order.push(layer); }
    byLayer.get(layer)!.push({ name, file, line: lineNo, role, next });
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
  const [lines, setLines] = useState<Line[]>([]); // 노드 간 연결선(측정된 좌표)
  const reqRef = useRef(0); // 최신 요청만 반영(빠른 feature 전환 경합 방지)
  const flowRef = useRef<HTMLDivElement | null>(null); // 연결선 좌표 기준 컨테이너
  const nodeEls = useRef(new Map<string, HTMLButtonElement>()); // 이름키 → 노드 DOM(엣지 끝점 측정)

  const load = useCallback(async () => {
    if (!feature || !root || !providerId || !providerSettings) return;
    const my = ++reqRef.current;
    nodeEls.current.clear(); setLines([]);
    setLoading(true); setErr(null); setSections(null);
    try {
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = basename(root);
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}`;
      const prompt = `레포 "${name}"에서 "${feature}" 기능의 아키텍처 흐름을 레이어별로 정리해줘. 진입(UI/route) → 처리(IPC/handler) → 서비스/로직 → 데이터/외부 순. 인사·서론·다른 설명 없이 **각 노드를 한 줄씩**, 아래 형식으로만:\n레이어 | 표시이름 | 파일경로:라인 | 한줄역할 | → 다음노드이름\n(파일경로는 위 목록의 실제 경로. 라인 모르면 파일만. "→ 다음노드"는 이 노드가 흐름상 이어지는 노드의 표시이름들(쉼표로 여러 개), 없으면 생략. 표시이름은 서로 정확히 일치시켜 연결되게. 예: 진입·UI | AnalyzeControls | src/components/AnalyzeControls.tsx | 분석 버튼 | → analyze route)`;
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

  // 연결선 좌표 측정 — 각 노드 DOM 위치를 컨테이너 기준 상대좌표로. wrap/리사이즈 후 다시.
  const measure = useCallback(() => {
    const cont = flowRef.current;
    if (!cont || !sections) { setLines([]); return; }
    const cr = cont.getBoundingClientRect();
    const out: Line[] = [];
    for (const s of sections) for (const n of s.nodes) {
      if (!n.next?.length) continue;
      const a = nodeEls.current.get(nk(n.name));
      if (!a) continue;
      const ar = a.getBoundingClientRect();
      const x1 = ar.left - cr.left + ar.width / 2, y1 = ar.bottom - cr.top;
      for (const target of n.next) {
        const b = nodeEls.current.get(nk(target));
        if (!b || b === a) continue;
        const br = b.getBoundingClientRect();
        out.push({ key: `${n.name}->${target}`, x1, y1, x2: br.left - cr.left + br.width / 2, y2: br.top - cr.top });
      }
    }
    setLines(out);
  }, [sections]);

  // feature 바뀌면 자동 로드.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 로드(내부 setState는 이펙트 동기 실행 아님)
  useEffect(() => { void load(); }, [load]);

  // 렌더 후 연결선 측정 + 컨테이너 리사이즈(wrap 변화) 시 재측정.
  useLayoutEffect(() => {
    measure();
    const cont = flowRef.current;
    if (!cont || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(cont);
    return () => ro.disconnect();
  }, [measure]);

  const anyEdge = !!sections?.some((s) => s.nodes.some((n) => n.next?.length)); // 엣지 있으면 선으로, 없으면 꺾쇠 폴백

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
          // 세로 흐름(위→아래) — 좁은 패널에서도 읽히게. 레이어=밴드, 노드 가로 wrap, 노드끼리 SVG 곡선 연결.
          <div ref={flowRef} className="relative mx-auto flex w-full max-w-2xl flex-col gap-1">
            {/* 연결선 오버레이 — 노드보다 뒤에 깔림(노드 배경이 덮어 끝점만 맞닿음). 클릭은 통과. */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <defs>
                <marker id="flow-arrow" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" className="fill-zinc-300 dark:fill-zinc-600" />
                </marker>
              </defs>
              {lines.map((l) => {
                const dy = Math.max(10, Math.abs(l.y2 - l.y1) / 2);
                return <path key={l.key} d={`M ${l.x1} ${l.y1} C ${l.x1} ${l.y1 + dy} ${l.x2} ${l.y2 - dy} ${l.x2} ${l.y2}`}
                  fill="none" strokeWidth={1.5} className="stroke-zinc-300 dark:stroke-zinc-600" markerEnd="url(#flow-arrow)" />;
              })}
            </svg>
            {sections.map((s, i) => (
              <div key={s.layer + i} className="relative flex flex-col gap-1">
                <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/30">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{s.layer}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.nodes.map((n, j) => (
                      <button key={j} type="button" disabled={!n.file}
                        ref={(el) => { if (el) nodeEls.current.set(nk(n.name), el); }}
                        onClick={() => n.file && onOpenFile?.(n.file, n.line)}
                        className={`relative z-10 flex min-w-[9rem] flex-1 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition ${n.file ? "cursor-pointer border-zinc-200 bg-white hover:border-[#3B34E2] dark:border-zinc-700 dark:bg-zinc-800/60 dark:hover:border-[#8b86f5]" : "cursor-default border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60"}`}>
                        <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{n.name}</span>
                        {n.file && <span className="font-mono text-[9px] text-[#3B34E2] dark:text-[#8b86f5]">{basename(n.file)}{n.line ? `:${n.line}` : ""}</span>}
                        {n.role && <span className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{n.role}</span>}
                      </button>
                    ))}
                  </div>
                </div>
                {!anyEdge && i < sections.length - 1 && (
                  <div className="flex justify-center text-zinc-300 dark:text-zinc-600"><IconChevronDown size={16} stroke={2} aria-hidden /></div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
