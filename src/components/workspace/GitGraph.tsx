"use client";
// 워크스페이스 깃 그래프(#649) — /api/repo/git-log → 파싱 → 레인 배정 → SVG(점·선) + 커밋행.
// 커밋 클릭 → 바뀐 파일(M/A/D) 펼침, 파일 클릭 → onOpenDiff(diff 뷰).
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconRefresh, IconGitBranch, IconTag, IconChevronRight, IconChevronDown, IconGitCommit } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { parseGitLog, assignLanes, githubLogin, type GitGraphModel } from "@/lib/repo/gitGraph";

// ref 배지 종류별 스타일 — 로컬 브랜치 / 원격(origin/*) / 태그 / 현재 HEAD 브랜치 구분(색 같으면 못 알아봄).
function refBadge(ref: string, curBranch: string) {
  if (ref === curBranch) return { cls: "bg-[#3B34E2] text-white dark:bg-[#8b86f5] dark:text-zinc-900", tag: false }; // 현재 브랜치 = 채움
  if (/^v?\d/.test(ref)) return { cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400", tag: true }; // 태그
  if (ref.includes("/")) return { cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400", tag: false };       // 원격(origin/…)
  return { cls: "bg-[#3B34E2]/10 text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]", tag: false };                    // 로컬 브랜치
}

const ROW_H = 24, FILE_H = 20, LANE_W = 14;
const LANE_COLORS = ["#3B34E2", "#e11d48", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const laneColor = (l: number) => LANE_COLORS[((l % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];
const cx = (lane: number) => lane * LANE_W + LANE_W / 2;
const STATUS = { M: ["M", "text-amber-600 dark:text-amber-500"], A: ["A", "text-emerald-600 dark:text-emerald-500"], D: ["D", "text-rose-600 dark:text-rose-500"], R: ["R", "text-sky-600 dark:text-sky-500"], C: ["C", "text-sky-600 dark:text-sky-500"] } as const;

// 워킹트리 변경 파일 한 건.
type Change = { path: string; index: string; work: string; added: number; deleted: number };
type WorktreeKind = "staged" | "unstaged" | "untracked";
// 변경의 diff 종류(클릭 시 어떤 diff를 열지) — unstaged 우선, 없으면 staged, ?? 는 untracked.
const changeKind = (c: Change): WorktreeKind => c.index === "?" ? "untracked" : (c.work !== " " && c.work !== "?") ? "unstaged" : "staged";
// 표시 배지: 문자 + 색.
function changeBadge(c: Change): { ch: string; cls: string } {
  if (c.index === "?" ) return { ch: "U", cls: "text-zinc-400" };
  if (c.index === "D" || c.work === "D") return { ch: "D", cls: "text-rose-600 dark:text-rose-500" };
  if (c.index === "A") return { ch: "A", cls: "text-emerald-600 dark:text-emerald-500" };
  if (c.index === "R") return { ch: "R", cls: "text-sky-600 dark:text-sky-500" };
  // staged(index)면 초록계, unstaged만이면 주황계.
  const staged = c.index !== " " && c.index !== "?";
  return { ch: "M", cls: staged ? "text-emerald-600 dark:text-emerald-500" : "text-amber-600 dark:text-amber-500" };
}

export default function GitGraph({ root, onOpenDiff, onFocusBranch, onOpenChange }: { root: string; onOpenDiff: (hash: string, file: string) => void; onFocusBranch: (branch: string) => void; onOpenChange?: (file: string, kind: WorktreeKind) => void }) {
  const t = useT();
  const [model, setModel] = useState<GitGraphModel | null>(null);
  const [isGit, setIsGit] = useState(true);
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesByHash, setFilesByHash] = useState<Record<string, { status: string; path: string }[]>>({});
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesOpen, setChangesOpen] = useState(true);

  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    try {
      const r = await fetch("/api/repo/git-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (r.ok && d.isGit) { setIsGit(true); setBranch(d.branch ?? ""); setModel(assignLanes(parseGitLog(d.log ?? ""))); }
      else { setIsGit(false); setModel(null); }
    } catch { setIsGit(false); setModel(null); }
    finally { setLoading(false); }
    // 워킹트리 변경(커밋 전) 목록.
    try {
      const r = await fetch("/api/repo/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      setChanges(r.ok && d.isGit && Array.isArray(d.files) ? d.files : []);
    } catch { setChanges([]); }
  }, [root]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load()가 setLoading 동기 호출(마운트/root 변경 시 로드)
  useEffect(() => { void load(); }, [load]);
  // 폴더 바뀌면 펼침·캐시 초기화.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- root 변경 시 펼침·캐시 리셋
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
        {isGit && branch ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded bg-[#3B34E2]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]" title={t("workspace.gitOnBranch", { branch })}>
            <span className="truncate">{branch}</span>
          </span>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">git</span>
        )}
        <button type="button" onClick={() => void load()} disabled={loading} className="ml-auto rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800" title={t("workspace.gitRefresh")}>
          <IconRefresh size={12} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {/* 워킹트리 변경(커밋 전) 섹션 — 커밋 그래프 위. 변경 없으면 숨김. */}
      {isGit && changes.length > 0 && (
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={() => setChangesOpen((v) => !v)} className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-[11px] font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50">
            {changesOpen ? <IconChevronDown size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden /> : <IconChevronRight size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />}
            <span>{t("workspace.gitChanges")}</span>
            <span className="rounded bg-zinc-200 px-1 text-[9px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{changes.length}</span>
          </button>
          {changesOpen && (
            <div className="max-h-[35%] overflow-auto pb-1">
              {changes.map((c) => {
                const b = changeBadge(c);
                const name = c.path.replace(/\/$/, "").split("/").pop() || c.path;
                return (
                  <button key={c.path} type="button" onClick={() => onOpenChange?.(c.path, changeKind(c))} className="flex w-full items-baseline gap-1.5 py-0.5 pl-6 pr-2 text-left text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <span className={`shrink-0 font-mono text-[9px] font-bold ${b.cls}`}>{b.ch}</span>
                    <span className="truncate text-zinc-700 dark:text-zinc-200">{name}</span>
                    <span className="truncate text-[9px] text-zinc-400 dark:text-zinc-500">{c.path}</span>
                    <span className="ml-auto shrink-0 font-mono text-[9px]">
                      {c.added > 0 && <span className="text-emerald-600 dark:text-emerald-500">+{c.added}</span>}
                      {c.added > 0 && c.deleted > 0 && " "}
                      {c.deleted > 0 && <span className="text-rose-600 dark:text-rose-500">−{c.deleted}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                    {row.commit.refs.map((rf) => {
                      const isCur = rf === branch; // 현재 체크아웃 브랜치 = HEAD 위치
                      const b = refBadge(rf, branch);
                      // 브랜치 배지(태그 제외) 클릭 → 그 브랜치 챗 세션(#653). 커밋 토글 전파 차단.
                      const clickable = !b.tag;
                      return (
                        <span key={rf} role={clickable ? "button" : undefined} tabIndex={clickable ? -1 : undefined}
                          onClick={clickable ? (e) => { e.stopPropagation(); onFocusBranch(rf); } : undefined}
                          className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[9px] font-medium ${b.cls} ${clickable ? "cursor-pointer hover:ring-1 hover:ring-current" : ""}`}
                          title={clickable ? t("workspace.gitAskBranch", { branch: rf }) : undefined}>
                          {isCur ? <IconGitCommit size={8} stroke={2.5} aria-hidden /> : b.tag ? <IconTag size={8} stroke={2} aria-hidden /> : <IconGitBranch size={8} stroke={2} aria-hidden />}
                          {isCur && <span className="font-bold">HEAD</span>}{rf}
                        </span>
                      );
                    })}
                    <span className="truncate text-zinc-700 dark:text-zinc-200">{row.commit.subject}</span>
                    {(() => { const login = githubLogin(row.commit.email); return <span className="ml-auto shrink-0 truncate text-[10px] text-zinc-400 dark:text-zinc-500">{login ? `@${login}` : row.commit.author}</span>; })()}
                    <span className="shrink-0 font-mono text-[10px] text-zinc-300 dark:text-zinc-600">{row.commit.hash.slice(0, 7)}</span>
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
