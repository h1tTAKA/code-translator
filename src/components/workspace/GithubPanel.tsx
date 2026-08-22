"use client";
// GitHub 패널(Epic #809, 서브2 #811) — 우측 패널의 GitHub 모드 컨테이너.
// 이번 서브는 골격: gh 연결 상태(서브1 #810 authDiagnose) 진단 + owner/repo 표시 + 안내.
// 실제 이슈·PR·CI는 서브3~5(#812/#813/#814)가 이 자리에 채운다.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconBrandGithub, IconLoader2, IconRefresh, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";
import IssueList from "@/components/workspace/github/IssueList";
import IssueDetail from "@/components/workspace/github/IssueDetail";
import PrList from "@/components/workspace/github/PrList";
import PrDetail from "@/components/workspace/github/PrDetail";

type AuthState = "ok" | "not-installed" | "not-authed" | "rate-limited" | "error";
type Probe = { loading: boolean; state?: AuthState; detail?: string };
type Tab = "issues" | "prs"; // CI는 별도 탭 대신 PR 상세에 통합(#812) + 헤더 도트

export default function GithubPanel({ root }: { root: string }) {
  const t = useT();
  const [probe, setProbe] = useState<Probe>({ loading: true });
  const [owner, setOwner] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("issues"); // 내부 탭(#814) — 이슈/PR
  const [openItem, setOpenItem] = useState<number | null>(null); // 상세 열림(현재 탭 기준). null=목록.
  const [reload, setReload] = useState(0); // 헤더 새로고침 → 목록 재조회 트리거.
  const repo = root ? root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? null : null;

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const run = useCallback(async () => {
    const gh = window.nunopiDesktop?.github;
    if (!gh?.auth || !root) { setProbe({ loading: false, state: "error", detail: t("github.desktopOnly") }); return; }
    setProbe({ loading: true });
    try {
      const r = await gh.auth(root);
      if (mountedRef.current) setProbe({ loading: false, state: r.state, detail: r.detail }); // 언마운트 후 setState 방지(리뷰 🔴)
    } catch (e) {
      if (mountedRef.current) setProbe({ loading: false, state: "error", detail: String((e as Error)?.message || e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t 제외: 로케일 전환 시 gh 재진단 유발 방지(에러 문자열만 영향, JSX 라벨은 live t로 리렌더)
  }, [root]);

  // owner는 git-remote route(#777) 재사용, gh 인증은 서브1 브릿지. root 바뀌면 재진단.
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- run이 진단 중 로딩 표시로 setState(마운트/root 변경 시 재진단)
    void run();
    (async () => {
      try {
        const rs = await fetch("/api/repo/git-remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
        const d = await rs.json();
        if (alive) setOwner(rs.ok ? (d.owner ?? null) : null);
      } catch { if (alive) setOwner(null); }
    })();
    return () => { alive = false; };
  }, [root, run]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 — 레포 식별 + 새로고침 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconBrandGithub size={14} stroke={2} className="shrink-0 text-zinc-700 dark:text-zinc-200" aria-hidden />
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
          {owner ? `${owner}/${repo ?? ""}` : (repo ?? "GitHub")}
        </span>
        <button type="button" onClick={() => { setReload((n) => n + 1); void run(); }} disabled={probe.loading}
          className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={t("github.refresh")} aria-label={t("github.refresh")}>
          <IconRefresh size={13} stroke={2} className={probe.loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {/* 본문 — 연결(ok)이면 이슈 목록/상세(#813), 아니면 상태별 안내 */}
      {probe.loading ? (
        <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500">
          <IconLoader2 size={14} className="animate-spin" aria-hidden /> {t("github.checking")}
        </div>
      ) : probe.state === "ok" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 내부 탭(#814) — 이슈/PR. 상세 열려 있으면 탭 숨김(뒤로가기로 목록 복귀). */}
          {openItem == null && (
            <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
              {(["issues", "prs"] as Tab[]).map((tb) => (
                <button key={tb} type="button" onClick={() => setTab(tb)} aria-pressed={tab === tb}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${tab === tb ? "bg-mustard-500/15 text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
                  {t(tb === "issues" ? "github.issues" : "github.prs")}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {tab === "issues"
              ? (openItem == null ? <IssueList root={root} reloadKey={reload} onOpen={setOpenItem} /> : <IssueDetail root={root} number={openItem} onBack={() => setOpenItem(null)} />)
              : (openItem == null ? <PrList root={root} reloadKey={reload} onOpen={setOpenItem} /> : <PrDetail root={root} number={openItem} onBack={() => setOpenItem(null)} />)}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <IconAlertTriangle size={15} stroke={2} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                  {probe.state === "not-installed" ? t("github.notInstalled")
                    : probe.state === "not-authed" ? t("github.notAuthed")
                    : probe.state === "rate-limited" ? t("github.rateLimited")
                    : t("github.error")}
                </p>
                {probe.detail && <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{probe.detail}</p>}
              </div>
            </div>
            <button type="button" onClick={run}
              className="self-start rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {t("github.retry")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
