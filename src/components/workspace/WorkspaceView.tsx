"use client";
// 워크스페이스 모드(#647) — 누노피 안에서 화면전환 없이 에이전트 코딩+즉시 학습.
// 골격(커밋1): 4존 셸 [파일트리 | 터미널 | 코드 | 챗]. 각 존은 후속 커밋서 채움(트리·코드·챗·pty터미널).
import { useEffect, useRef, useState } from "react";
import { IconFolderOpen, IconFiles, IconFileCode, IconLoader2, IconGitBranch, IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import FileTree from "@/components/workspace/FileTree";
import CodePane from "@/components/workspace/CodePane";
import WorkspaceChat from "@/components/workspace/WorkspaceChat";
import Terminal from "@/components/workspace/Terminal";
import GitGraph from "@/components/workspace/GitGraph";
import DiffPane from "@/components/workspace/DiffPane";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

const WS_PATH_KEY = "nunopi:workspace-path";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 빈 존 자리표시 — 후속 커밋서 실제 트리/코드/챗/터미널로 교체.
function ZonePlaceholder({ Icon, label }: { Icon: typeof IconFiles; label: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-zinc-300 dark:text-zinc-600">
      <Icon size={22} stroke={1.75} aria-hidden />
      <span className="text-[11px] font-medium">{label} <span className="opacity-70">{t("workspace.soon")}</span></span>
    </div>
  );
}

export default function WorkspaceView({ active = true, providerId, providerSettings }: { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings }) {
  const t = useT();
  const [path, setPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null); // 열린 파일(코드칸은 이게 있을 때만)
  const [openDiff, setOpenDiff] = useState<{ hash: string; file: string } | null>(null); // 커밋 diff(있으면 코드칸=diff)
  // 패널 폭(px) — 드래그 리사이즈, localStorage 영속.
  const [treeW, setTreeW] = useState(240);
  const [chatW, setChatW] = useState(320);
  const [codeW, setCodeW] = useState(480);
  const [gitOpen, setGitOpen] = useState(false);   // 좌 하단 깃 그래프 열림
  const [gitH, setGitH] = useState(220);           // 깃 그래프 높이(px)
  const dragRef = useRef<{ kind: "tree" | "code" | "chat" | "gitH"; startX: number; startY: number; startVal: number } | null>(null);
  const wRef = useRef({ tree: 240, chat: 320, code: 480, gitH: 220 }); // 최신 폭·높이 미러(드래그 종료 시 영속용)
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(SSR/Electron 판별 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  useEffect(() => {
    if (!mounted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 후 저장 경로 복원(1회)
    try { const s = localStorage.getItem(WS_PATH_KEY); if (s) setPath(s); } catch { /* ignore */ }
  }, [mounted]);

  // 저장된 패널 폭 복원.
  useEffect(() => {
    if (!mounted) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 후 저장 폭 복원(1회)
      const t = Number(localStorage.getItem("nunopi:ws-tree-w")); if (t) { const v = clamp(t, 140, 560); setTreeW(v); wRef.current.tree = v; }
      const c = Number(localStorage.getItem("nunopi:ws-chat-w")); if (c) { const v = clamp(c, 200, 640); setChatW(v); wRef.current.chat = v; }
      const k = Number(localStorage.getItem("nunopi:ws-code-w")); if (k) { const v = clamp(k, 240, 900); setCodeW(v); wRef.current.code = v; }
      const gh = Number(localStorage.getItem("nunopi:ws-git-h")); if (gh) { const v = clamp(gh, 80, 500); setGitH(v); wRef.current.gitH = v; }
      setGitOpen(localStorage.getItem("nunopi:ws-git-open") === "1");
    } catch { /* ignore */ }
  }, [mounted]);

  // 드래그 리사이즈 — 전역 mousemove/up 리스너.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.startX;
      if (d.kind === "tree") { const v = clamp(d.startVal + dx, 140, 560); setTreeW(v); wRef.current.tree = v; }
      else if (d.kind === "code") { const v = clamp(d.startVal - dx, 240, 900); setCodeW(v); wRef.current.code = v; }
      else if (d.kind === "chat") { const v = clamp(d.startVal - dx, 200, 640); setChatW(v); wRef.current.chat = v; }
      else { const dy = e.clientY - d.startY; const v = clamp(d.startVal - dy, 80, 500); setGitH(v); wRef.current.gitH = v; } // gitH: 세로
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "";
      try {
        localStorage.setItem("nunopi:ws-tree-w", String(wRef.current.tree));
        localStorage.setItem("nunopi:ws-chat-w", String(wRef.current.chat));
        localStorage.setItem("nunopi:ws-code-w", String(wRef.current.code));
        localStorage.setItem("nunopi:ws-git-h", String(wRef.current.gitH));
      } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const startDrag = (kind: "tree" | "code" | "chat" | "gitH", startVal: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // eslint-disable-next-line react-hooks/refs -- 이벤트 핸들러 내 ref 쓰기(렌더 중 아님)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startVal };
    document.body.style.cursor = kind === "gitH" ? "row-resize" : "col-resize"; document.body.style.userSelect = "none";
  };

  const toggleGit = () => setGitOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-git-open", n ? "1" : "0"); } catch { /* ignore */ } return n; });

  // 폴더 정해지면 파일트리 로드.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴더 바뀌면 트리 재로드(경로 변경 시)
    if (!path) { setFiles([]); return; }
    let cancelled = false;
    setTreeLoading(true); setOpenFile(null);
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        if (!cancelled) setFiles(r.ok && Array.isArray(d.files) ? d.files : []);
      } catch { if (!cancelled) setFiles([]); }
      finally { if (!cancelled) setTreeLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [path]);

  void active;

  async function pick() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) { setPath(r.path); try { localStorage.setItem(WS_PATH_KEY, r.path); } catch { /* ignore */ } }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  const folderName = path ? path.split("/").filter(Boolean).pop() ?? path : null;

  // 웹(비데스크톱): 터미널·폴더접근 불가 → 안내.
  if (mounted && !desktop) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>
    );
  }

  // 폴더 미선택: 선택 유도.
  if (!path) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:text-[#8b86f5]">
            <IconFiles size={26} stroke={1.75} aria-hidden />
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("workspace.intro")}</p>
          <button type="button" onClick={pick} disabled={picking || !mounted}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3B34E2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#322bc9] disabled:opacity-50 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]">
            <IconFolderOpen size={16} stroke={2} aria-hidden /> {t("workspace.pickFolder")}
          </button>
        </div>
      </div>
    );
  }

  // 4존 셸.
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconFiles size={15} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
        <span className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{folderName}</span>
        <button type="button" onClick={pick} disabled={picking}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
          <IconFolderOpen size={14} stroke={2} aria-hidden /> {t("workspace.pickFolder")}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* 좌: 파일트리(위) + 깃 그래프(아래, 접기·세로 리사이즈) */}
        <aside style={{ width: treeW }} className="flex shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="min-h-0 flex-1 overflow-hidden">
            {treeLoading ? (
              <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>
            ) : files.length > 0 ? (
              <FileTree files={files} selected={openFile} onSelect={(id) => { setOpenFile(id); setOpenDiff(null); }} />
            ) : (
              <ZonePlaceholder Icon={IconFiles} label={t("workspace.tree")} />
            )}
          </div>
          {gitOpen && (
            <>
              <div onMouseDown={startDrag("gitH", gitH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
              <div style={{ height: gitH }} className="shrink-0 overflow-hidden border-t border-zinc-200 dark:border-zinc-800"><GitGraph root={path} onOpenDiff={(hash, file) => setOpenDiff({ hash, file })} /></div>
            </>
          )}
          <button type="button" onClick={toggleGit} className="flex shrink-0 items-center gap-1.5 border-t border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <IconGitBranch size={12} stroke={2} aria-hidden />
            <span>git</span>
            {gitOpen ? <IconChevronDown size={12} stroke={2} className="ml-auto" aria-hidden /> : <IconChevronUp size={12} stroke={2} className="ml-auto" aria-hidden />}
          </button>
        </aside>
        <div onMouseDown={startDrag("tree", treeW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
        {/* 가운데: 터미널 | (파일 열면) 코드 */}
        <section className="flex min-w-0 flex-1">
          <div className="min-w-0 flex-1"><Terminal cwd={path} /></div>
          {(openFile || openDiff) && (
            <>
              <div onMouseDown={startDrag("code", codeW)} className="w-1 shrink-0 cursor-col-resize border-l border-zinc-200 transition hover:bg-[#3B34E2]/40 dark:border-zinc-800 dark:hover:bg-[#8b86f5]/40" />
              <div style={{ width: codeW }} className="flex shrink-0 flex-col">
                <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <IconFileCode size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                  {openDiff ? (
                    <span className="truncate">{openDiff.file} <span className="font-mono text-zinc-400 dark:text-zinc-500">@ {openDiff.hash.slice(0, 7)}</span></span>
                  ) : (
                    <span className="truncate">{openFile}</span>
                  )}
                  <button type="button" onClick={() => { setOpenDiff(null); setOpenFile(null); }} className="ml-auto shrink-0 rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label="close">×</button>
                </div>
                <div className="min-h-0 flex-1">
                  {openDiff ? <DiffPane root={path} hash={openDiff.hash} file={openDiff.file} /> : openFile ? <CodePane root={path} file={openFile} /> : null}
                </div>
              </div>
            </>
          )}
        </section>
        <div onMouseDown={startDrag("chat", chatW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
        {/* 우: 챗룸 */}
        <aside style={{ width: chatW }} className="flex shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
          <WorkspaceChat root={path} openFile={openFile} providerId={providerId} providerSettings={providerSettings} />
        </aside>
      </div>
    </div>
  );
}
