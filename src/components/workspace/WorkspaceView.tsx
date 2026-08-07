"use client";
// 워크스페이스 모드(#647) — 누노피 안에서 화면전환 없이 에이전트 코딩+즉시 학습.
// 골격(커밋1): 4존 셸 [파일트리 | 터미널 | 코드 | 챗]. 각 존은 후속 커밋서 채움(트리·코드·챗·pty터미널).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconFolderOpen, IconFiles, IconFileCode, IconFileText, IconLoader2, IconGitBranch, IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import FileTree from "@/components/workspace/FileTree";
import CodePane from "@/components/workspace/CodePane";
import WorkspaceChat, { type ChatFocus } from "@/components/workspace/WorkspaceChat";
import TerminalPane from "@/components/workspace/TerminalPane";
import GitGraph from "@/components/workspace/GitGraph";
import DiffPane from "@/components/workspace/DiffPane";
import DocPane from "@/components/workspace/DocPane";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

const WS_PATH_KEY = "nunopi:workspace-path";
const WS_DOCS_KEY = "nunopi:ws-docs-path"; // 문서 폴더(#693)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// git status 문자(index,work) → 파일 트리 도트 종류. 삭제(D)는 트리에 행이 없어 스킵(#687).
function statusKind(index: string, work: string): "added" | "modified" | null {
  if (index === "D" || work === "D") return null;      // 삭제 — 트리 미표시
  if (index === "?" || index === "A") return "added";  // untracked / staged-add = 신규
  return "modified";                                   // M / R / C 등 = 수정
}

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
  const [fileStatus, setFileStatus] = useState<Record<string, "added" | "modified">>({}); // 변경 파일 도트(#687)
  const [treeLoading, setTreeLoading] = useState(false);
  // 문서 뷰어(#693) — 레포와 별개 문서 폴더. docFile은 docsRoot 기준 상대경로.
  const [docsRoot, setDocsRoot] = useState<string | null>(null);
  const [docsFiles, setDocsFiles] = useState<string[]>([]);
  const [docFile, setDocFile] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false); // 좌측 문서 섹션 열림
  const [openFile, setOpenFile] = useState<string | null>(null); // 열린 파일(코드칸은 이게 있을 때만)
  // 커밋 diff(hash) 또는 워킹트리 diff(worktree). 있으면 코드칸=diff.
  const [openDiff, setOpenDiff] = useState<{ hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked" } | null>(null);
  // 챗 포커스 신호(#653) — 파일/diff/브랜치 클릭 시 그 챗 세션 열기. n(nonce)로 같은 대상 재클릭도 발화.
  const [chatFocus, setChatFocus] = useState<ChatFocus | null>(null);
  const focusN = useRef(0);
  const focusChat = (key: string, kind: ChatFocus["kind"], label: string) => { focusN.current += 1; setChatFocus({ key, kind, label, n: focusN.current }); };
  // 패널 폭(px) — 드래그 리사이즈, localStorage 영속.
  const [treeW, setTreeW] = useState(240);
  const [chatW, setChatW] = useState(320);
  const [codeW, setCodeW] = useState(480);
  const [gitOpen, setGitOpen] = useState(false);   // 좌 하단 깃 그래프 열림
  const [gitH, setGitH] = useState(220);           // 깃 그래프 높이(px)
  const [docsH, setDocsH] = useState(220);         // 문서 브라우저 높이(px, #693)
  const dragRef = useRef<{ kind: "tree" | "code" | "chat" | "gitH" | "docsH"; startX: number; startY: number; startVal: number } | null>(null);
  const wRef = useRef({ tree: 240, chat: 320, code: 480, gitH: 220, docsH: 220 }); // 최신 폭·높이 미러(드래그 종료 시 영속용)
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(SSR/Electron 판별 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  useEffect(() => {
    if (!mounted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 후 저장 경로 복원(1회)
    try { const s = localStorage.getItem(WS_PATH_KEY); if (s) setPath(s); } catch { /* ignore */ }
    try { const ds = localStorage.getItem(WS_DOCS_KEY); if (ds) setDocsRoot(ds); } catch { /* ignore */ } // 문서 폴더 복원(#693)
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
      const dh = Number(localStorage.getItem("nunopi:ws-docs-h")); if (dh) { const v = clamp(dh, 80, 500); setDocsH(v); wRef.current.docsH = v; }
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
      else if (d.kind === "gitH") { const dy = e.clientY - d.startY; const v = clamp(d.startVal - dy, 80, 500); setGitH(v); wRef.current.gitH = v; } // 세로
      else { const dy = e.clientY - d.startY; const v = clamp(d.startVal - dy, 80, 500); setDocsH(v); wRef.current.docsH = v; } // docsH: 세로
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "";
      try {
        localStorage.setItem("nunopi:ws-tree-w", String(wRef.current.tree));
        localStorage.setItem("nunopi:ws-chat-w", String(wRef.current.chat));
        localStorage.setItem("nunopi:ws-code-w", String(wRef.current.code));
        localStorage.setItem("nunopi:ws-git-h", String(wRef.current.gitH));
        localStorage.setItem("nunopi:ws-docs-h", String(wRef.current.docsH));
      } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const startDrag = (kind: "tree" | "code" | "chat" | "gitH" | "docsH", startVal: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // eslint-disable-next-line react-hooks/refs -- 이벤트 핸들러 내 ref 쓰기(렌더 중 아님)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startVal };
    document.body.style.cursor = (kind === "gitH" || kind === "docsH") ? "row-resize" : "col-resize"; document.body.style.userSelect = "none";
  };

  const toggleGit = () => setGitOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-git-open", n ? "1" : "0"); } catch { /* ignore */ } return n; });

  // 워킹트리 변경 상태맵 로드(#687 도트 + #689 챗 승계 트리거). 경로 로드·깃 새로고침 시 호출.
  const loadGitStatus = useCallback(async (p: string) => {
    try {
      const rs = await fetch("/api/repo/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
      const ds = await rs.json();
      const map: Record<string, "added" | "modified"> = {};
      // 키는 트리(scan)와 같은 repo-relative POSIX. git porcelain은 항상 "/"지만 방어적 정규화.
      if (rs.ok && ds.isGit && Array.isArray(ds.files)) for (const f of ds.files) { const k = statusKind(f.index ?? "", f.work ?? ""); if (k && typeof f.path === "string") map[f.path.replace(/\\/g, "/")] = k; }
      setFileStatus(map);
    } catch { setFileStatus({}); }
  }, []);
  // 변경 파일 경로 집합(챗 승계 판별용, #689) — fileStatus 바뀔 때만 새 identity(effect 무한루프 방지).
  const changedFileSet = useMemo(() => new Set(Object.keys(fileStatus)), [fileStatus]);
  // 깃 그래프 새로고침 시 상태맵도 갱신 — stable(inline이면 GitGraph load가 매 렌더 재생성→무한 fetch).
  const handleGitRefreshed = useCallback(() => { if (path) void loadGitStatus(path); }, [path, loadGitStatus]);

  // 폴더 정해지면 파일트리 로드.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴더 바뀌면 트리 재로드(경로 변경 시)
    if (!path) { setFiles([]); setFileStatus({}); return; }
    let cancelled = false;
    setTreeLoading(true); setOpenFile(null);
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        if (!cancelled) setFiles(r.ok && Array.isArray(d.files) ? d.files : []);
      } catch { if (!cancelled) setFiles([]); }
      finally { if (!cancelled) setTreeLoading(false); }
      if (!cancelled) void loadGitStatus(path); // 변경 파일 상태 도트(#687)·워킹트리 챗 승계(#689)용
    })();
    return () => { cancelled = true; };
  }, [path, loadGitStatus]);

  // 문서 폴더 파일 목록 로드(#693) — /api/repo/tree 재사용(root=docsRoot).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 문서 폴더 변경 시 재로드
    if (!docsRoot) { setDocsFiles([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: docsRoot }) });
        const d = await r.json();
        if (!cancelled) setDocsFiles(r.ok && Array.isArray(d.files) ? d.files : []);
      } catch { if (!cancelled) setDocsFiles([]); }
    })();
    return () => { cancelled = true; };
  }, [docsRoot]);

  void active;

  async function pick() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) { setPath(r.path); try { localStorage.setItem(WS_PATH_KEY, r.path); } catch { /* ignore */ } }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  // 문서 폴더 선택(#693) — 범용 폴더 선택기 재사용.
  async function pickDocs() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) { setDocsRoot(r.path); try { localStorage.setItem(WS_DOCS_KEY, r.path); } catch { /* ignore */ } }
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
              <FileTree files={files} status={fileStatus} selected={openFile} onSelect={(id) => { setOpenFile(id); setOpenDiff(null); focusChat(`file:${id}`, "file", id.split("/").pop() ?? id); }} />
            ) : (
              <ZonePlaceholder Icon={IconFiles} label={t("workspace.tree")} />
            )}
          </div>
          {gitOpen && (
            <>
              <div onMouseDown={startDrag("gitH", gitH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
              <div style={{ height: gitH }} className="shrink-0 overflow-hidden border-t border-zinc-200 dark:border-zinc-800"><GitGraph root={path} onOpenDiff={(hash, file) => { setOpenDiff({ hash, file }); focusChat(`diff:${hash}:${file}`, "diff", `${file.split("/").pop()} @${hash.slice(0, 7)}`); }} onFocusBranch={(b) => focusChat(`branch:${b}`, "branch", b)} onOpenChange={(file, worktree) => { const f = file.replace(/\\/g, "/"); setOpenDiff({ file, worktree }); focusChat(`wt:${f}`, "worktree", `${f.split("/").pop() ?? f} · 변경`); }} onRefreshed={handleGitRefreshed} /></div>
            </>
          )}
          <button type="button" onClick={toggleGit} className="flex shrink-0 items-center gap-1.5 border-t border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <IconGitBranch size={12} stroke={2} aria-hidden />
            <span>git</span>
            {gitOpen ? <IconChevronDown size={12} stroke={2} className="ml-auto" aria-hidden /> : <IconChevronUp size={12} stroke={2} className="ml-auto" aria-hidden />}
          </button>
          {/* 문서 폴더 브라우저(#693) — .md/.txt 클릭 시 뷰어에 표시(뷰어는 커밋2). */}
          {docsOpen && (
            <>
            <div onMouseDown={startDrag("docsH", docsH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
            <div style={{ height: docsH }} className="flex shrink-0 flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-800">
              {docsRoot ? (
                <>
                  <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    <IconFolderOpen size={11} stroke={2} className="shrink-0" aria-hidden />
                    <span className="truncate">{docsRoot.split("/").filter(Boolean).pop()}</span>
                    <button type="button" onClick={pickDocs} className="ml-auto shrink-0 rounded px-1 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">{t("workspace.docsChangeFolder")}</button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <FileTree files={docsFiles} selected={docFile} onSelect={(id) => { if (/\.(md|markdown|txt)$/i.test(id)) setDocFile(id); }} />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center p-3">
                  <button type="button" onClick={pickDocs} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <IconFolderOpen size={13} stroke={2} aria-hidden /> {t("workspace.docsOpenFolder")}
                  </button>
                </div>
              )}
            </div>
            </>
          )}
          <button type="button" onClick={() => setDocsOpen((v) => !v)} className="flex shrink-0 items-center gap-1.5 border-t border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <IconFileText size={12} stroke={2} aria-hidden />
            <span>{t("workspace.docs")}</span>
            {docsOpen ? <IconChevronDown size={12} stroke={2} className="ml-auto" aria-hidden /> : <IconChevronUp size={12} stroke={2} className="ml-auto" aria-hidden />}
          </button>
        </aside>
        <div onMouseDown={startDrag("tree", treeW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
        {/* 가운데: 터미널 | (파일 열면) 코드 */}
        <section className="flex min-w-0 flex-1">
          <div className="min-w-0 flex-1"><TerminalPane cwd={path} /></div>
          {(openFile || openDiff || (docFile && docsRoot)) && (
            <>
              <div onMouseDown={startDrag("code", codeW)} className="w-1 shrink-0 cursor-col-resize border-l border-zinc-200 transition hover:bg-[#3B34E2]/40 dark:border-zinc-800 dark:hover:bg-[#8b86f5]/40" />
              <div style={{ width: codeW }} className="flex shrink-0 flex-col">
                {(openFile || openDiff) ? (
                  <>
                    <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <IconFileCode size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                      {openDiff ? (
                        <span className="truncate">{openDiff.file} <span className="font-mono text-zinc-400 dark:text-zinc-500">{openDiff.hash ? `@ ${openDiff.hash.slice(0, 7)}` : `· ${openDiff.worktree}`}</span></span>
                      ) : (
                        <span className="truncate">{openFile}</span>
                      )}
                      <button type="button" onClick={() => { setOpenDiff(null); setOpenFile(null); }} className="ml-auto shrink-0 rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label="close">×</button>
                    </div>
                    <div className="min-h-0 flex-1">
                      {openDiff ? <DiffPane root={path} hash={openDiff.hash} file={openDiff.file} worktree={openDiff.worktree} providerId={providerId} providerSettings={providerSettings} /> : openFile ? <CodePane root={path} file={openFile} /> : null}
                    </div>
                  </>
                ) : (docFile && docsRoot) ? (
                  // 코드/diff 없을 때만 문서 전체 표시(코드/diff와 상하 공존은 커밋3).
                  <DocPane root={docsRoot} file={docFile} onClose={() => setDocFile(null)} />
                ) : null}
              </div>
            </>
          )}
        </section>
        <div onMouseDown={startDrag("chat", chatW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
        {/* 우: 챗룸 */}
        <aside style={{ width: chatW }} className="flex shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
          <WorkspaceChat root={path} files={files} focus={chatFocus} changedFiles={changedFileSet} providerId={providerId} providerSettings={providerSettings} />
        </aside>
      </div>
    </div>
  );
}
