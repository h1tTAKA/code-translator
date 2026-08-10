"use client";
// 워크스페이스 모드(#647) — 누노피 안에서 화면전환 없이 에이전트 코딩+즉시 학습.
// 골격(커밋1): 4존 셸 [파일트리 | 터미널 | 코드 | 챗]. 각 존은 후속 커밋서 채움(트리·코드·챗·pty터미널).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconFolderOpen, IconFiles, IconFileCode, IconFileText, IconLoader2, IconGitBranch, IconGitCommit, IconX, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconMessages, IconBrain, IconSettings, IconSitemap } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import FileTree from "@/components/workspace/FileTree";
import CodePane from "@/components/workspace/CodePane";
import WorkspaceChat, { type ChatFocus } from "@/components/workspace/WorkspaceChat";
import TerminalPane from "@/components/workspace/TerminalPane";
import UsageMonitor from "@/components/workspace/UsageMonitor";
import GitGraph from "@/components/workspace/GitGraph";
import DiffPane from "@/components/workspace/DiffPane";
import DocViewer from "@/components/workspace/DocViewer";
import RepoFlowPane from "@/components/workspace/RepoFlowPane";
import RepoAnalyzeSection from "@/components/workspace/RepoAnalyzeSection";
import WorkspaceDockLayout, { defaultTree, pruneTree, leavesOf, isDockNode, appendPanel, removePanel, type DockNode, type PanelId } from "@/components/workspace/WorkspaceDockLayout";
import type { AgentProviderKind, ProviderSettings } from "@/lib/agent";

// 코드/diff 멀티탭 한 건(#714) — 파일 또는 diff(커밋 diff는 hash, 워킹트리 diff는 worktree).
type CodeTab = { kind: "file"; file: string } | { kind: "diff"; hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked" };
// 탭 식별 키(중복 열기 방지·활성 지정). file / diff(hash) / diff(워킹트리) 구분.
const codeTabKey = (tb: CodeTab) => tb.kind === "file" ? `file:${tb.file}` : `diff:${tb.hash ?? "wt:" + (tb.worktree ?? "")}:${tb.file}`;
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

// path(레포)는 WorkspaceTabs가 소유해 prop로 내려준다(#731). key={path}로 탭마다 인스턴스 분리.
export default function WorkspaceView({ path, active = true, providerId, providerSettings, onExitWorkspace, onOpenMemorize, onOpenSettings, tabStrip }: { path: string; active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; onExitWorkspace?: () => void; onOpenMemorize?: () => void; onOpenSettings?: () => void; tabStrip?: ReactNode }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState<Record<string, "added" | "modified">>({}); // 변경 파일 도트(#687)
  const [treeLoading, setTreeLoading] = useState(false);
  // 문서 뷰어(#693) — 레포와 별개 문서 폴더. docTabs/activeDoc은 docsRoot 기준 상대경로.
  const [docsRoot, setDocsRoot] = useState<string | null>(null);
  const [docsFiles, setDocsFiles] = useState<string[]>([]);
  const [docTabs, setDocTabs] = useState<string[]>([]); // 열린 문서 탭(rel 경로들, #693)
  const [activeDoc, setActiveDoc] = useState<string | null>(null); // 활성 문서
  const [docsOpen, setDocsOpen] = useState(false); // 좌측 문서 섹션 열림
  // 중앙 3패널 커스텀 도킹 분할 트리(#716) — 터미널·코드·문서를 자유 배치. null이면 기본 트리 생성.
  const [dockTree, setDockTree] = useState<DockNode | null>(null);
  // 코드/diff 멀티탭(#714) — 파일·diff를 탭으로 쌓음(터미널·문서처럼). openFile/openDiff 단일 슬롯 대체.
  const [codeTabs, setCodeTabs] = useState<CodeTab[]>([]);
  const [activeCode, setActiveCode] = useState<string | null>(null); // 활성 탭 키(codeTabKey)
  // 챗 포커스 신호(#653) — 파일/diff/브랜치 클릭 시 그 챗 세션 열기. n(nonce)로 같은 대상 재클릭도 발화.
  const [chatFocus, setChatFocus] = useState<ChatFocus | null>(null);
  const focusN = useRef(0);
  const focusChat = (key: string, kind: ChatFocus["kind"], label: string) => { focusN.current += 1; setChatFocus({ key, kind, label, n: focusN.current }); };
  // 패널 폭(px) — 드래그 리사이즈, localStorage 영속.
  const [treeW, setTreeW] = useState(240);
  const [chatW, setChatW] = useState(320);
  const [chatOpen, setChatOpen] = useState(true);  // 우측 챗 패널 열림(#695)
  const [gitOpen, setGitOpen] = useState(false);   // 좌 하단 깃 그래프 열림
  const [treeOpen, setTreeOpen] = useState(true);  // 파일 트리 열림(#733) — 하단 아이콘 바 토글, 기본 열림
  const [analyzeOpen, setAnalyzeOpen] = useState(false); // 좌측 "레포 분석하기" 섹션 열림(#743)
  const [flowFeature, setFlowFeature] = useState<string | null>(null); // 열린 플로우 패널의 기능(null=닫힘). dock에 flow 패널 존재 여부와 동기(#743)
  const [archChatFeature, setArchChatFeature] = useState<string | null>(null); // arch 질문세션을 연 기능(#746) — 이 기능 카드 클릭 시만 좌표 삽입
  const [chatPrefill, setChatPrefill] = useState<{ text: string; n: number } | null>(null); // 챗 입력창 자동 삽입 신호(#746)
  const [gitH, setGitH] = useState(220);           // 깃 그래프 높이(px)
  const [docsH, setDocsH] = useState(220);         // 문서 브라우저 높이(px, #693)
  const [analyzeH, setAnalyzeH] = useState(240);   // 레포 분석 섹션 높이(px, #743)
  const asideRef = useRef<HTMLElement | null>(null); // 좌측 사이드바 — 세로 리사이즈 상한 계산용(#743)
  const dragRef = useRef<{ kind: "tree" | "chat" | "gitH" | "docsH" | "analyzeH"; startX: number; startY: number; startVal: number } | null>(null);
  const wRef = useRef({ tree: 240, chat: 320, gitH: 220, docsH: 220, analyzeH: 240 }); // 최신 폭·높이 미러(드래그 종료 시 영속용). 중앙은 도킹 트리 관리.
  const [mounted, setMounted] = useState(false);
  const repoLoadedRef = useRef<string | null>(null); // 현재 열린 상태가 복원된 레포 path — 전환 중 오염 방지·저장 게이트(#712)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(SSR/Electron 판별 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 저장된 패널 폭 복원.
  useEffect(() => {
    if (!mounted) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 후 저장 폭 복원(1회)
      const t = Number(localStorage.getItem("nunopi:ws-tree-w")); if (t) { const v = clamp(t, 140, 560); setTreeW(v); wRef.current.tree = v; }
      const c = Number(localStorage.getItem("nunopi:ws-chat-w")); if (c) { const v = clamp(c, 200, 640); setChatW(v); wRef.current.chat = v; }
      const gh = Number(localStorage.getItem("nunopi:ws-git-h")); if (gh) { const v = clamp(gh, 80, 1600); setGitH(v); wRef.current.gitH = v; }
      const dh = Number(localStorage.getItem("nunopi:ws-docs-h")); if (dh) { const v = clamp(dh, 80, 1600); setDocsH(v); wRef.current.docsH = v; }
      const ah = Number(localStorage.getItem("nunopi:ws-analyze-h")); if (ah) { const v = clamp(ah, 80, 1600); setAnalyzeH(v); wRef.current.analyzeH = v; }
      setGitOpen(localStorage.getItem("nunopi:ws-git-open") === "1");
      setTreeOpen(localStorage.getItem("nunopi:ws-tree-open") !== "0"); // 기본 열림, "0"일 때만 닫힘(#733)
      setAnalyzeOpen(localStorage.getItem("nunopi:ws-analyze-open") === "1"); // 기본 닫힘(#743)
      setChatOpen(localStorage.getItem("nunopi:ws-chat-open") !== "0"); // 기본 열림, "0"일 때만 닫힘(#695)
    } catch { /* ignore */ }
  }, [mounted]);

  // 좌측 최소 하나 보장(#733·#743) — 트리·git·문서·분석 전부 닫힘이면 트리를 연다(빈 사이드바 방지·구 상태 복구).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mounted && !treeOpen && !gitOpen && !docsOpen && !analyzeOpen) setTreeOpen(true);
  }, [mounted, treeOpen, gitOpen, docsOpen, analyzeOpen]);

  // 레포별 열린 상태 복원(#712) — path(레포) 바뀔 때마다 그 레포의 저장분을 로드(챗처럼 레포 스코프). 없으면 초기화.
  useEffect(() => {
    if (!mounted) return;
    const p = path;
    if (!p) { repoLoadedRef.current = null; return; }
    const K = (b: string) => `nunopi:ws:${p}:${b}`;
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- path 변경 시 그 레포 상태 복원 */
      // 코드/diff 탭 복원(#714) — file은 경로, diff는 hash 또는 worktree 중 하나는 반드시 있어야 통과(둘 다 없는 깨진 탭 배제).
      let ctabs: CodeTab[] = [];
      try { const ct = JSON.parse(localStorage.getItem(K("code-tabs")) || "null"); if (Array.isArray(ct)) ctabs = ct.filter((x): x is CodeTab => x && typeof x.file === "string" && (x.kind === "file" || (x.kind === "diff" && (typeof x.hash === "string" || typeof x.worktree === "string")))); } catch { /* ignore */ }
      setCodeTabs(ctabs);
      // 활성 키가 복원된 탭에 없으면 마지막 탭으로 폴백(빈 pane 방지).
      const ac = localStorage.getItem(K("active-code"));
      setActiveCode(ctabs.some((tb) => codeTabKey(tb) === ac) ? ac : (ctabs.length ? codeTabKey(ctabs[ctabs.length - 1]) : null));
      setDocsRoot(localStorage.getItem(K("docs-root")) || null);
      try { const dt = JSON.parse(localStorage.getItem(K("doc-tabs")) || "null"); setDocTabs(Array.isArray(dt) ? dt.filter((x): x is string => typeof x === "string") : []); } catch { setDocTabs([]); }
      setActiveDoc(localStorage.getItem(K("active-doc")) || null);
      setDocsOpen(localStorage.getItem(K("docs-open")) === "1");
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch { /* ignore */ }
    repoLoadedRef.current = p;
  }, [path, mounted]);

  // 레포 스코프 저장(#712) — 복원된 레포와 현재 path 일치할 때만(전환 중 A→B 오염 방지). deps는 값만, path는 클로저.
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:docs-root`; try { if (docsRoot) localStorage.setItem(k, docsRoot); else localStorage.removeItem(k); } catch { /* ignore */ } }, [docsRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:doc-tabs`; try { if (docTabs.length) localStorage.setItem(k, JSON.stringify(docTabs)); else localStorage.removeItem(k); } catch { /* ignore */ } }, [docTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:active-doc`; try { if (activeDoc) localStorage.setItem(k, activeDoc); else localStorage.removeItem(k); } catch { /* ignore */ } }, [activeDoc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:docs-open`; try { localStorage.setItem(k, docsOpen ? "1" : "0"); } catch { /* ignore */ } }, [docsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // 코드/diff 탭 영속(#714).
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:code-tabs`; try { if (codeTabs.length) localStorage.setItem(k, JSON.stringify(codeTabs)); else localStorage.removeItem(k); } catch { /* ignore */ } }, [codeTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:active-code`; try { if (activeCode) localStorage.setItem(k, activeCode); else localStorage.removeItem(k); } catch { /* ignore */ } }, [activeCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 드래그 리사이즈 — 전역 mousemove/up 리스너.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      // 세로 리사이즈 상한 = 사이드바 높이 - 여유(위 채움 섹션 + 하단 바). 500 고정 캡 제거(#743).
      const maxH = Math.max(160, (asideRef.current?.clientHeight ?? 800) - 120);
      if (d.kind === "tree") { const v = clamp(d.startVal + dx, 140, 560); setTreeW(v); wRef.current.tree = v; }
      else if (d.kind === "chat") { const v = clamp(d.startVal - dx, 200, 640); setChatW(v); wRef.current.chat = v; }
      else if (d.kind === "gitH") { const v = clamp(d.startVal - dy, 80, maxH); setGitH(v); wRef.current.gitH = v; }
      else if (d.kind === "analyzeH") { const v = clamp(d.startVal - dy, 80, maxH); setAnalyzeH(v); wRef.current.analyzeH = v; }
      else { const v = clamp(d.startVal - dy, 80, maxH); setDocsH(v); wRef.current.docsH = v; } // docsH
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "";
      try {
        localStorage.setItem("nunopi:ws-tree-w", String(wRef.current.tree));
        localStorage.setItem("nunopi:ws-chat-w", String(wRef.current.chat));
        localStorage.setItem("nunopi:ws-git-h", String(wRef.current.gitH));
        localStorage.setItem("nunopi:ws-docs-h", String(wRef.current.docsH));
        localStorage.setItem("nunopi:ws-analyze-h", String(wRef.current.analyzeH));
      } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const startDrag = (kind: "tree" | "chat" | "gitH" | "docsH" | "analyzeH", startVal: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // eslint-disable-next-line react-hooks/refs -- 이벤트 핸들러 내 ref 쓰기(렌더 중 아님)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startVal };
    document.body.style.cursor = (kind === "gitH" || kind === "docsH" || kind === "analyzeH") ? "row-resize" : "col-resize"; document.body.style.userSelect = "none";
  };

  // 중앙 도킹 트리 동기화·영속(#716) — 존재 패널(터미널 항상·코드=탭·문서=열림)에 맞춰 트리 유지.
  // 레포 전환 시 그 레포의 저장 트리를 base로 로드(레포별 영속), 아니면 이전 트리 유지. 리프 집합 같으면 배치·비율 보존, 다르면 prune 후 필요 시 기본.
  const hasCode = codeTabs.length > 0;
  const hasDoc = !!(docsRoot && activeDoc && docTabs.length);
  const dockRepoRef = useRef<string | null>(null); // 현재 dockTree가 로드된 레포 — 전환 감지·저장 게이트
  const flowRepoRef = useRef<string | null>(null); // flowFeature가 복원된 레포 — 전환 시 그 레포 저장값으로 복원(#743)
  useEffect(() => {
    if (!mounted || !path) return;
    const has: Record<PanelId, boolean> = { terminal: true, code: hasCode, doc: hasDoc, flow: flowFeature !== null };
    const switched = dockRepoRef.current !== path;
    let stored: DockNode | null = null;
    if (switched) { try { const j = JSON.parse(localStorage.getItem(`nunopi:ws:${path}:dock-tree`) || "null"); if (isDockNode(j)) stored = j; } catch { /* ignore */ } dockRepoRef.current = path; }
    setDockTree((prev) => {
      const base = switched ? stored : prev;
      const pruned = base ? pruneTree(base, has) : null;
      const cur = pruned ? leavesOf(pruned) : new Set<PanelId>();
      const need = (["terminal", "code", "doc", "flow"] as PanelId[]).filter((p) => has[p]);
      const same = pruned && need.length === cur.size && need.every((p) => cur.has(p));
      return same ? pruned : defaultTree(has);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flowFeature는 아래 전용 이펙트가 증분 삽입/제거(여기 넣으면 배치 재빌드로 커스텀 배치 유실)
  }, [path, hasCode, hasDoc, mounted]);
  // 플로우 패널 증분 삽입/제거(#743) — flowFeature 토글 시 커스텀 dock 배치를 보존하며 flow 리프만 추가/삭제.
  useEffect(() => {
    if (!mounted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flowFeature 토글 시 dock 트리 증분 갱신(함수형 업데이트)
    setDockTree((prev) => {
      if (!prev) return prev;
      const inTree = leavesOf(prev).has("flow");
      if (flowFeature !== null && !inTree) return appendPanel(prev, "flow");
      if (flowFeature === null && inTree) return removePanel(prev, "flow") ?? prev;
      return prev;
    });
  }, [flowFeature, mounted]);
  // 도킹 트리 저장(#716) — 로드된 레포와 현재 path 일치할 때만(전환 오염 방지).
  useEffect(() => { if (!path || dockRepoRef.current !== path || !dockTree) return; try { localStorage.setItem(`nunopi:ws:${path}:dock-tree`, JSON.stringify(dockTree)); } catch { /* ignore */ } }, [dockTree]); // eslint-disable-line react-hooks/exhaustive-deps -- path 제외: 전환 커밋에 옛 트리를 새 레포 키에 쓰는 오염 방지(dockTree 변할 때만 저장)

  // 열린 플로우 기능 영속(#743) — 레포 전환/재진입 시 그 레포에 저장된 flowFeature 복원(플로우 패널 자동 복귀).
  useEffect(() => {
    if (!mounted || !path || flowRepoRef.current === path) return;
    flowRepoRef.current = path;
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nunopi:ws:${path}:flow-feature`) || null; } catch { /* ignore */ }
    setFlowFeature(saved);
  }, [path, mounted]);
  useEffect(() => {
    if (!path || flowRepoRef.current !== path) return; // 전환 커밋에 옛 값 오염 방지
    try { if (flowFeature) localStorage.setItem(`nunopi:ws:${path}:flow-feature`, flowFeature); else localStorage.removeItem(`nunopi:ws:${path}:flow-feature`); } catch { /* ignore */ }
  }, [flowFeature]); // eslint-disable-line react-hooks/exhaustive-deps -- flowFeature 변할 때만 저장(path 변화는 위 복원 이펙트가 담당)

  // 좌측 4섹션(트리·git·문서·분석) 중 최소 하나는 열려 있어야 — 빈 사이드바 방지(#733·#743). 마지막 하나는 못 끔.
  const leftOpenCount = (treeOpen ? 1 : 0) + (gitOpen ? 1 : 0) + (docsOpen ? 1 : 0) + (analyzeOpen ? 1 : 0);
  // 남는 세로 공간을 채우는(flex-1) 섹션 = 열린 것 중 최상위(순서: 폴더>레포분석>깃>문서). 나머지는 고정 높이(#733·#743).
  const leftFill: "tree" | "analyze" | "git" | "docs" = treeOpen ? "tree" : analyzeOpen ? "analyze" : gitOpen ? "git" : "docs";
  const toggleGit = () => { if (gitOpen && leftOpenCount === 1) return; setGitOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-git-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleTree = () => { if (treeOpen && leftOpenCount === 1) return; setTreeOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-tree-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleDocs = () => { if (docsOpen && leftOpenCount === 1) return; setDocsOpen((v) => !v); };
  const toggleAnalyze = () => { if (analyzeOpen && leftOpenCount === 1) return; setAnalyzeOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-analyze-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleChat = () => setChatOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-chat-open", n ? "1" : "0"); } catch { /* ignore */ } return n; });
  // 이 아키텍처(기능)에 대해 질문(#746) — 우측 챗에 arch 세션 열고(focus) 챗 패널 펴기.
  const askArch = (feature: string) => { focusChat(`arch:${feature}`, "arch", feature); setArchChatFeature(feature); setChatOpen(true); try { localStorage.setItem("nunopi:ws-chat-open", "1"); } catch { /* ignore */ } };
  // 카드→좌표 삽입(#746) — 이 기능의 arch 질문세션이 열려 있을 때만 챗 입력창에 지칭 문구를 넣는다.
  const quoteNode = (text: string) => {
    if (!chatOpen || flowFeature == null || archChatFeature !== flowFeature) return; // 세션 안 열렸으면 무시(카드 클릭=포커스만)
    focusChat(`arch:${flowFeature}`, "arch", flowFeature); // arch 세션 활성 보장
    setChatPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }));
  };

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

  // 실시간 갱신(#739) — 활성 워크스페이스의 레포를 파일 워처로 감시. 변경 시 도트 재로드 + gitNonce↑(GitGraph 재fetch).
  // 활성 path만 watch(keep-alive 멀티탭 중복 방지). recursive 미지원이면 폴링 폴백.
  const [gitNonce, setGitNonce] = useState(0);
  useEffect(() => {
    if (!mounted || !active || !path) return;
    const api = window.nunopiDesktop;
    if (!api?.repo) return;
    const id = path;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => { void loadGitStatus(path); setGitNonce((n) => n + 1); };
    const onChange = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(refresh, 250); };
    const off = api.repo.onChanged((p) => { if (p.id === id) onChange(); });
    // watch 지원이어도 저빈도(15s) 안전망 폴링 병행 — fs.watch가 나중에 조용히 죽거나(좀비) 이벤트를 놓쳐도 결국 갱신.
    // 미지원(supported:false)/실패면 이벤트가 없으니 빠른 3s 주기로.
    void api.repo.watch({ id, root: path })
      .then((r) => { poll = setInterval(refresh, r && r.supported === false ? 3000 : 15000); })
      .catch(() => { poll = setInterval(refresh, 3000); });
    return () => {
      off();
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      void api.repo?.unwatch({ id });
    };
  }, [mounted, active, path, loadGitStatus]);

  // 폴더 정해지면 파일트리 로드.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴더 바뀌면 트리 재로드(경로 변경 시)
    if (!path) { setFiles([]); setFileStatus({}); return; }
    let cancelled = false;
    setTreeLoading(true);
    // 레포 전환 시 이전 목록·상태 즉시 비움 — key={path}로 리마운트되는 FileTree가 옛 레포의 changedAncestors(변경 폴더)를
    // 물어 그 폴더 펼침이 새 레포 저장분에 섞이는 것 방지(#712 리뷰). 열린 파일 초기화는 안 함(위 path 이펙트가 레포별 복원).
    setFiles([]); setFileStatus({});
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

  // 문서 폴더 선택(#693) — 범용 폴더 선택기 재사용.
  async function pickDocs() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder();
      if (!r.canceled && r.path) {
        setDocsRoot(r.path);
        setDocTabs([]); setActiveDoc(null); // 새 문서 폴더 = 이전 탭 무효. 레포 스코프 저장 이펙트가 반영(#712)
      }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  // 문서 탭 열기/닫기(#693) — 브라우저서 클릭해 열림(+ 버튼 없음).
  function openDoc(id: string) { setDocTabs((prev) => (prev.includes(id) ? prev : [...prev, id])); setActiveDoc(id); }
  function closeDocTab(id: string) {
    setDocTabs((prev) => prev.filter((x) => x !== id));
    setActiveDoc((cur) => { if (cur !== id) return cur; const rest = docTabs.filter((x) => x !== id); return rest.length ? rest[rest.length - 1] : null; });
  }

  // 코드/diff 탭(#714) — 문서 탭과 동형. 그 탭 컨텍스트로 챗 포커스도 맞춘다.
  const focusForTab = (tb: CodeTab) => {
    const name = tb.file.split("/").pop() ?? tb.file;
    if (tb.kind === "file") focusChat(`file:${tb.file}`, "file", name);
    else if (tb.hash) focusChat(`diff:${tb.hash}:${tb.file}`, "diff", `${name} @${tb.hash.slice(0, 7)}`);
    else { const f = tb.file.replace(/\\/g, "/"); focusChat(`wt:${f}`, "worktree", `${f.split("/").pop() ?? f} · 변경`); }
  };
  function openCodeTab(tb: CodeTab) {
    const key = codeTabKey(tb);
    setCodeTabs((prev) => (prev.some((x) => codeTabKey(x) === key) ? prev : [...prev, tb])); // 있으면 그대로(활성만 바꿈), 없으면 추가
    setActiveCode(key);
    focusForTab(tb);
  }
  function activateCode(key: string) {
    setActiveCode(key);
    const tb = codeTabs.find((x) => codeTabKey(x) === key);
    if (tb) focusForTab(tb);
  }
  function closeCodeTab(key: string) {
    setCodeTabs((prev) => prev.filter((x) => codeTabKey(x) !== key));
    setActiveCode((cur) => { if (cur !== key) return cur; const rest = codeTabs.filter((x) => codeTabKey(x) !== key); return rest.length ? codeTabKey(rest[rest.length - 1]) : null; });
  }
  const activeTab = codeTabs.find((tb) => codeTabKey(tb) === activeCode) ?? null;
  const activeFile = activeTab?.kind === "file" ? activeTab.file : null; // FileTree 선택 하이라이트용

  // 웹(비데스크톱): 터미널·폴더접근 불가 → 안내.
  if (mounted && !desktop) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>
    );
  }

  // 코드/diff 노드(멀티탭, #714) — 문서 뷰어(DocViewer)와 동형 탭 바 + 활성 pane. 코드 영역 분할 배치에 재사용(#693).
  const codeNode = codeTabs.length ? (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 바(스크롤) — 파일/diff 각 탭. × 로 닫기, 클릭으로 전환. pr-6: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[#15161d]">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {codeTabs.map((tb) => {
            const key = codeTabKey(tb);
            const on = key === activeCode;
            const name = tb.file.split("/").pop() ?? tb.file;
            return (
              <div key={key} onClick={() => activateCode(key)}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[#0b0c12] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundImage: "linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)" }} aria-hidden />}
                {tb.kind === "diff"
                  ? <IconGitCommit size={13} stroke={2} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#8b86f5]" : "text-zinc-400"}`} aria-hidden />
                  : <IconFileCode size={13} stroke={2} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#8b86f5]" : "text-zinc-400"}`} aria-hidden />}
                <span className="whitespace-nowrap">{name}{tb.kind === "diff" && <span className="ml-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{tb.hash ? `@${tb.hash.slice(0, 7)}` : `· ${tb.worktree}`}</span>}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); closeCodeTab(key); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("mem.close")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab?.kind === "diff"
          ? <DiffPane key={activeCode} root={path} hash={activeTab.hash} file={activeTab.file} worktree={activeTab.worktree} providerId={providerId} providerSettings={providerSettings} />
          : activeTab?.kind === "file"
            ? <CodePane key={activeCode} root={path} file={activeTab.file} />
            : null}
      </div>
    </div>
  ) : null;
  // 문서 노드(#716) — 배치는 도킹 트리가 담당하므로 DocViewer의 dock 토글은 넘기지 않음(디자인·탭은 그대로).
  const docNode = hasDoc ? (
    <DocViewer root={docsRoot!} tabs={docTabs} activeDoc={activeDoc!} onActivate={setActiveDoc} onCloseTab={closeDocTab} />
  ) : null;
  // 도킹 트리에 넘길 패널 3종(존재하는 것만 트리 리프로 렌더됨). 기존 컴포넌트 그대로.
  const dockPanels: Record<PanelId, ReactNode> = {
    terminal: <TerminalPane cwd={path} />,
    code: codeNode,
    doc: docNode,
    // 기능별 아키텍처 플로우(#743) — flowFeature 있을 때만 dock에 삽입됨. 노드 클릭 → 코드 탭 열기.
    flow: <RepoFlowPane feature={flowFeature} root={path} providerId={providerId} providerSettings={providerSettings} onOpenFile={(file) => openCodeTab({ kind: "file", file })} onAskArch={askArch} onQuoteNode={quoteNode} onClose={() => setFlowFeature(null)} />,
  };

  // 4존 셸.
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 헤더 한 줄(#731) — 좌: 워크스페이스 탭(이름이 탭에 있어 별도 폴더명 줄 없음), 우: 영역 컨트롤. */}
      <header className="flex items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800">
        {tabStrip}
        {/* 영역 컨트롤(#721) — 질문·분석으로 나가기 / 암기(카드덱) / 설정 / 챗 토글. */}
        {(onExitWorkspace || onOpenMemorize || onOpenSettings) && <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
        {onExitWorkspace && (
          <button type="button" onClick={onExitWorkspace} title={t("workspace.toQA")} aria-label={t("workspace.toQA")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconMessages size={16} stroke={2} aria-hidden />
          </button>
        )}
        {onOpenMemorize && (
          <button type="button" onClick={onOpenMemorize} title={t("mode.memorize")} aria-label={t("mode.memorize")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconBrain size={16} stroke={2} aria-hidden />
          </button>
        )}
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} title={t("header.settings")} aria-label={t("header.settings")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconSettings size={16} stroke={2} aria-hidden />
          </button>
        )}
        {/* 우측 챗 패널 접기/펴기(#716·#695) — 헤더 토글. 열림=collapse 아이콘, 접힘=expand 아이콘. */}
        <button type="button" onClick={toggleChat} title={chatOpen ? t("workspace.chatCollapse") : t("workspace.chatExpand")} aria-label={chatOpen ? t("workspace.chatCollapse") : t("workspace.chatExpand")}
          className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {chatOpen ? <IconLayoutSidebarRightCollapse size={16} stroke={2} aria-hidden /> : <IconLayoutSidebarRightExpand size={16} stroke={2} aria-hidden />}
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {/* 좌: 파일트리(위) + 깃 그래프(아래, 접기·세로 리사이즈) */}
        <aside ref={asideRef} style={{ width: treeW }} className="flex shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          {treeOpen && (
            <div className="min-h-0 flex-1 overflow-hidden">
              {treeLoading ? (
                <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>
              ) : files.length > 0 ? (
                <FileTree key={path} files={files} status={fileStatus} selected={activeFile} storageKey={path ? `nunopi:ws:${path}:tree-open` : undefined} onSelect={(id) => openCodeTab({ kind: "file", file: id })} />
              ) : (
                <ZonePlaceholder Icon={IconFiles} label={t("workspace.tree")} />
              )}
            </div>
          )}
          {/* 레포 분석하기 섹션(#743) — [분석하기]→카테고리→기능 플로우. 순서: 폴더 다음. 세로 리사이즈·전체영역. */}
          {analyzeOpen && (
            <>
              {leftFill !== "analyze" && <div onMouseDown={startDrag("analyzeH", analyzeH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />}
              <div style={leftFill === "analyze" ? undefined : { height: analyzeH }} className={`flex flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "analyze" ? "min-h-0 flex-1" : "shrink-0"}`}>
                <RepoAnalyzeSection root={path} providerId={providerId} providerSettings={providerSettings} onOpenFlow={(f) => setFlowFeature(f)} />
              </div>
            </>
          )}
          {gitOpen && (
            <>
              {leftFill !== "git" && <div onMouseDown={startDrag("gitH", gitH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />}
              <div style={leftFill === "git" ? undefined : { height: gitH }} className={`overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "git" ? "min-h-0 flex-1" : "shrink-0"}`}><GitGraph root={path} onOpenDiff={(hash, file) => openCodeTab({ kind: "diff", hash, file })} onFocusBranch={(b) => focusChat(`branch:${b}`, "branch", b)} onOpenChange={(file, worktree) => openCodeTab({ kind: "diff", file, worktree })} onRefreshed={handleGitRefreshed} refreshNonce={gitNonce} /></div>
            </>
          )}
          {/* 문서 폴더 브라우저(#693) — .md/.txt 클릭 시 뷰어에 표시(뷰어는 커밋2). */}
          {docsOpen && (
            <>
            {leftFill !== "docs" && <div onMouseDown={startDrag("docsH", docsH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />}
            <div style={leftFill === "docs" ? undefined : { height: docsH }} className={`flex flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "docs" ? "min-h-0 flex-1" : "shrink-0"}`}>
              {docsRoot ? (
                <>
                  <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    <IconFolderOpen size={11} stroke={2} className="shrink-0" aria-hidden />
                    <span className="truncate">{docsRoot.split("/").filter(Boolean).pop()}</span>
                    <button type="button" onClick={pickDocs} className="ml-auto shrink-0 rounded px-1 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">{t("workspace.docsChangeFolder")}</button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <FileTree key={docsRoot} files={docsFiles} selected={activeDoc} storageKey={path ? `nunopi:ws:${path}:docs-tree-open` : undefined} onSelect={(id) => { if (/\.(md|markdown|txt)$/i.test(id)) openDoc(id); }} />
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
          {/* 하단 아이콘 바(#733·#743) — 폴더·분석·git·문서 패널 토글(순서 일치). */}
          <div className="flex shrink-0 items-center gap-0.5 border-t border-zinc-200 px-1.5 py-0.5 dark:border-zinc-800">
            <button type="button" onClick={toggleTree} title={t("workspace.tree")} aria-label={t("workspace.tree")} aria-pressed={treeOpen}
              className={`rounded-md p-1 transition ${treeOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconFiles size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleAnalyze} title={t("repo.analyzeSection")} aria-label={t("repo.analyzeSection")} aria-pressed={analyzeOpen}
              className={`rounded-md p-1 transition ${analyzeOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconSitemap size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleGit} title="git" aria-label="git" aria-pressed={gitOpen}
              className={`rounded-md p-1 transition ${gitOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconGitBranch size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleDocs} title={t("workspace.docs")} aria-label={t("workspace.docs")} aria-pressed={docsOpen}
              className={`rounded-md p-1 transition ${docsOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconFileText size={14} stroke={2} aria-hidden />
            </button>
            {/* 우측 끝 — Claude·Codex 토큰 사용량 모니터(#735). active일 때만 폴링(중복 방지). */}
            <div className="ml-auto"><UsageMonitor active={active} /></div>
          </div>
        </aside>
        <div onMouseDown={startDrag("tree", treeW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
        {/* 가운데: 커스텀 도킹 분할 트리(터미널·코드·문서 자유 배치, #716). 기존 패널 그대로 렌더만 재배치. */}
        <section className="flex min-w-0 flex-1">
          {dockTree && <WorkspaceDockLayout tree={dockTree} panels={dockPanels} onTreeChange={setDockTree} />}
        </section>
        {/* 우: 챗룸(접기/펴기 #695) — 접힘 시 aside·divider 미렌더(폭 0). 토글은 아래 플로팅 엣지 탭. */}
        {chatOpen && (
          <>
            <div onMouseDown={startDrag("chat", chatW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
            <aside style={{ width: chatW }} className="flex shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
              <WorkspaceChat root={path} files={files} focus={chatFocus} prefill={chatPrefill} changedFiles={changedFileSet} providerId={providerId} providerSettings={providerSettings} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
