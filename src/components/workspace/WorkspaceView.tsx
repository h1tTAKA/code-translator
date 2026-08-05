"use client";
// 워크스페이스 모드(#647) — 누노피 안에서 화면전환 없이 에이전트 코딩+즉시 학습.
// 골격(커밋1): 4존 셸 [파일트리 | 터미널 | 코드 | 챗]. 각 존은 후속 커밋서 채움(트리·코드·챗·pty터미널).
import { useEffect, useState } from "react";
import { IconFolderOpen, IconFiles, IconTerminal2, IconFileCode, IconMessageCircle, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import FileTree from "@/components/workspace/FileTree";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

const WS_PATH_KEY = "nunopi:workspace-path";

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
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(SSR/Electron 판별 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  useEffect(() => {
    if (!mounted) return;
    try { const s = localStorage.getItem(WS_PATH_KEY); if (s) setPath(s); } catch { /* ignore */ }
  }, [mounted]);

  // 폴더 정해지면 파일트리 로드.
  useEffect(() => {
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

  // providerId/providerSettings — 우측 챗룸(후속 커밋)서 사용.
  void providerId; void providerSettings; void active;

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
        {/* 좌: 파일트리 */}
        <aside className="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
          {treeLoading ? (
            <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>
          ) : files.length > 0 ? (
            <FileTree files={files} selected={openFile} onSelect={setOpenFile} />
          ) : (
            <ZonePlaceholder Icon={IconFiles} label={t("workspace.tree")} />
          )}
        </aside>
        {/* 가운데: 터미널 | (파일 열면) 코드 */}
        <section className="flex min-w-0 flex-1">
          <div className="min-w-0 flex-1"><ZonePlaceholder Icon={IconTerminal2} label={t("workspace.terminal")} /></div>
          {openFile && (
            <div className="flex min-w-0 flex-1 flex-col border-l border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <IconFileCode size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                <span className="truncate">{openFile}</span>
              </div>
              <div className="min-h-0 flex-1"><ZonePlaceholder Icon={IconFileCode} label={t("workspace.code")} /></div>
            </div>
          )}
        </section>
        {/* 우: 챗룸 */}
        <aside className="w-80 shrink-0 border-l border-zinc-200 dark:border-zinc-800"><ZonePlaceholder Icon={IconMessageCircle} label={t("workspace.chat")} /></aside>
      </div>
    </div>
  );
}
