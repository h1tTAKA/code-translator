"use client";

import { useCallback, useState } from "react";
import { IconSitemap, IconSparkles, IconLoader2, IconChevronRight } from "@tabler/icons-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

// 레포 기능 카테고리(#743) — 에이전트가 파일 목록 보고 나눔.
export type RepoCategory = { id: string; title: string; blurb?: string };
type StreamEvent = { type: string; line?: string; message?: string; response?: { summary?: string } };

// 에이전트 응답(자유 텍스트)에서 첫 JSON 배열만 뽑아 카테고리로. 코드펜스·서두 방어.
function parseCategories(text: string): RepoCategory[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.title === "string")
      .map((x, i) => ({ id: typeof x.id === "string" && x.id ? x.id : `cat-${i}`, title: String(x.title), blurb: typeof x.blurb === "string" ? x.blurb : undefined }));
  } catch {
    return [];
  }
}

// 좌측 "레포 분석하기" 섹션(#743) — [분석하기] → 기능 카테고리 목록 → 클릭 → 플로우 패널(feature=title).
export default function RepoAnalyzeSection({ root, providerId, providerSettings, onOpenFlow }: {
  root: string;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onOpenFlow?: (feature: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [cats, setCats] = useState<RepoCategory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); // 실패 원인 상세(디버깅·안내)

  const analyze = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setDetail(null);
    const fail = (d: string) => { setErr(t("repo.analyzeError")); setDetail(d); };
    try {
      // 1) 레포 파일 목록(컨텍스트) — 노이즈 제외 + 상한(토큰 방어).
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      if (!tr.ok) { fail(`tree HTTP ${tr.status}`); return; }
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      if (!files.length) { fail("no files (tree empty)"); return; }
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = root.split("/").filter(Boolean).pop() ?? root;
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}`;
      const prompt = `위 레포 파일 목록을 보고, 사용자가 이해할 만한 "기능/영역" 카테고리로 6~12개로 나눠라. 각 항목은 {"id": kebab-case 영문 슬러그, "title": 짧은 제목, "blurb": 한 줄 설명}. **JSON 배열만** 출력하라(코드펜스·다른 설명 금지).`;
      // 2) chat 모드 재사용(WorkspaceChat과 동일 경로) — 스트림 result.summary = 응답 텍스트.
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
      });
      if (!res.ok || !res.body) { const b = await res.text().catch(() => ""); fail(`analyze HTTP ${res.status}${b ? ` ${b.slice(0, 160)}` : ""}`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "result") answer = ev.response?.summary ?? "";
          else if (ev.type === "error") streamErr = ev.message ?? "stream error";
        }
      }
      if (streamErr) { fail(`agent: ${streamErr}`); return; }
      if (!answer.trim()) { fail("empty response (provider 설정 확인)"); return; }
      const parsed = parseCategories(answer);
      if (!parsed.length) { fail(`no JSON array — ${answer.slice(0, 160)}`); return; }
      setCats(parsed);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [root, providerId, providerSettings, locale, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <IconSitemap size={11} stroke={2} className="shrink-0" aria-hidden />
        <span className="truncate">{t("repo.analyzeSection")}</span>
        <button type="button" onClick={() => void analyze()} disabled={loading}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-[#3B34E2] px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50">
          {loading ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={11} stroke={2} aria-hidden />}
          {t("repo.analyzeRun")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && !cats ? (
          <p className="px-1 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">{t("repo.analyzing")}</p>
        ) : err ? (
          <div className="px-1 py-2">
            <p className="text-[11px] text-rose-500">{err}</p>
            {detail && <p className="mt-1 break-words text-[10px] text-zinc-400 dark:text-zinc-500">{detail}</p>}
          </div>
        ) : cats ? (
          <div className="flex flex-col gap-0.5">
            {cats.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenFlow?.(c.title)}
                className="group flex items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <IconChevronRight size={12} stroke={2} className="mt-0.5 shrink-0 text-zinc-400 group-hover:text-[#3B34E2] dark:group-hover:text-[#8b86f5]" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{c.title}</span>
                  {c.blurb && <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">{c.blurb}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 py-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("repo.analyzeSoon")}</p>
        )}
      </div>
    </div>
  );
}
