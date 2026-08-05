"use client";
// 워크스페이스 깃 그래프(#649) — /api/repo/git-log → 파싱 → 레인 배정 → SVG(점·선) + 커밋행.
// 커밋 클릭 → 바뀐 파일(M/A/D) 펼침, 파일 클릭 → onOpenDiff(diff 뷰).
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconRefresh, IconGitBranch, IconTag, IconChevronRight } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { parseGitLog, assignLanes, type GitGraphModel } from "@/lib/repo/gitGraph";

const ROW_H = 24, FILE_H = 20, LANE_W = 14;
const LANE_COLORS = ["#3B34E2", "#e11d48", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const laneColor = (l: number) => LANE_COLORS[((l % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];
const cx = (lane: number) => lane * LANE_W + LANE_W / 2;
const STATUS = { M: ["M", "text-amber-600 dark:text-amber-500"], A: ["A", "text-emerald-600 dark:text-emerald-500"], D: ["D", "text-rose-600 dark:text-rose-500"], R: ["R", "text-sky-600 dark:text-sky-500"], C: ["C", "text-sky-600 dark:text-sky-500"] } as const;

export default function GitGraph({ root, onOpenDiff }: { root: string; onOpenDiff: (hash: string, file: string) => void }) {
  const t = useT();
  const [model, setModel] = useState<GitGraphModel | null>(null);
  const [isGit, setIsGit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesByHash, setFilesByHash] = useState<Record<string, { status: string; path: string }[]>>({});

  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    try {
      const r = await fetch("/api/repo/git-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (r.ok && d.isGit) { setIsGit(true); setModel(assignLanes(parseGitLog(d.log ?? ""))); }
      else { setIsGit(false); setModel(null); }
    } catch { setIsGit(false); setModel(null); }
    finally { setLoading(false); }
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  // 폴더 바뀌면 펼침·캐시 초기화.
  useEffect(() => { setExpanded(new Set()); setFilesByHash({}); }, [root]);

  const toggle = async (hash: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(hash)) n.delete(hash); else n.add(hash); return n; });
    if (!filesByHash[hash]) {
      try {
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash }) });
        const d = await r.json();
        setFilesByHash((prev) => ({ ...prev, [hash]: d.ok && Array.isArray(d.files) ? d.files : [] }));
      } catch { setFilesByHash((prev) => ({ ...prev, [hash]: [] })); }
    }
  };

  const graphW = useMemo(() => (model ? Math.max(1, model.laneCount) * LANE_W : LANE_W), [model]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
        <IconGitBranch size={13} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">git</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="ml-auto rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800" title={t("workspace.gitRefresh")}>
          <IconRefresh size={12} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {loading && !model ? (
        <div className="flex flex-1 items-center justify-center text-zinc-400"><IconLoader2 size={15} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : !isGit ? (
        <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.gitNone")}</div>
      ) : (
        <div className="nunopi-scroll min-h-0 flex-1 overflow-auto">
          {model?.rows.map((row) => {
            const dotY = ROW_H / 2;
            const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
            row.before.forEach((h, i) => {
              if (h == null) return;
              if (h === row.commit.hash) lines.push({ x1: cx(i), y1: 0, x2: cx(row.lane), y2: dotY, color: laneColor(i) });
              else { const j = row.after.indexOf(h); if (j >= 0) lines.push({ x1: cx(i), y1: 0, x2: cx(j), y2: ROW_H, color: laneColor(i) }); }
            });
            row.commit.parents.forEach((p) => { const j = row.after.indexOf(p); if (j >= 0) lines.push({ x1: cx(row.lane), y1: dotY, x2: cx(j), y2: ROW_H, color: laneColor(j) }); });
            const isOpen = expanded.has(row.commit.hash);
            const files = filesByHash[row.commit.hash];
            return (
              <div key={row.commit.hash}>
                <button type="button" onClick={() => void toggle(row.commit.hash)} className="flex w-full items-center text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50" style={{ height: ROW_H }}>
                  <svg width={graphW} height={ROW_H} className="shrink-0" style={{ minWidth: graphW }} aria-hidden>
                    {lines.map((l, k) => <line key={k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={1.5} />)}
                    <circle cx={cx(row.lane)} cy={dotY} r={3.5} fill={laneColor(row.lane)} />
                  </svg>
                  <IconChevronRight size={11} stroke={2} className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 pr-2 text-[11px]">
                    {row.commit.refs.map((rf) => (
                      <span key={rf} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[#3B34E2]/10 px-1 text-[9px] font-medium text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]">
                        {/^v?\d/.test(rf) ? <IconTag size={8} stroke={2} aria-hidden /> : <IconGitBranch size={8} stroke={2} aria-hidden />}{rf}
                      </span>
                    ))}
                    <span className="truncate text-zinc-700 dark:text-zinc-200">{row.commit.subject}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{row.commit.hash.slice(0, 7)}</span>
                  </span>
                </button>
                {isOpen && (
                  <div>
                    {files == null ? (
                      <div className="flex items-center pl-[var(--gw)] text-zinc-400" style={{ height: FILE_H, ["--gw" as string]: `${graphW}px` }}><IconLoader2 size={11} stroke={2} className="ml-3 animate-spin" aria-hidden /></div>
                    ) : files.length === 0 ? (
                      <div className="flex items-center text-[10px] text-zinc-400" style={{ height: FILE_H }}><span style={{ width: graphW }} className="shrink-0" /><span className="pl-3">(변경 없음)</span></div>
                    ) : files.map((f) => {
                      const [badge, cls] = STATUS[f.status as keyof typeof STATUS] ?? ["?", "text-zinc-400"];
                      return (
                        <button key={f.path} type="button" onClick={() => onOpenDiff(row.commit.hash, f.path)} className="flex w-full items-center text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" style={{ height: FILE_H }}>
                          {/* 그래프 열: 활성 레인 pass-through(연속성) */}
                          <svg width={graphW} height={FILE_H} className="shrink-0" style={{ minWidth: graphW }} aria-hidden>
                            {row.after.map((h, i) => h == null ? null : <line key={i} x1={cx(i)} y1={0} x2={cx(i)} y2={FILE_H} stroke={laneColor(i)} strokeWidth={1.5} />)}
                          </svg>
                          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 pl-3 pr-2 text-[11px]">
                            <span className={`shrink-0 font-mono text-[9px] font-bold ${cls}`}>{badge}</span>
                            <span className="truncate text-zinc-600 dark:text-zinc-300">{f.path.split("/").pop()}</span>
                            <span className="truncate text-[9px] text-zinc-400 dark:text-zinc-500">{f.path}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
