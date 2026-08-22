"use client";
// 현재 브랜치 CI 상태 도트(#812) — github:checks를 30s 폴링해 진행/통과/실패를 반환.
// 상단 GitHub 토글 아이콘 배지용. PR 없음/닫힘·체크 없음이면 null(도트 숨김).
import { useEffect, useState } from "react";
import { normalizeChecks, summarize } from "@/components/workspace/github/checks";

export type CiDot = "running" | "success" | "failure" | null;

export function useBranchCi(root: string | undefined): CiDot {
  const [dot, setDot] = useState<CiDot>(null);
  useEffect(() => {
    const gh = window.nunopiDesktop?.github;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- root/미지원 변경 시 도트 리셋
    if (!gh?.checks || !root) { setDot(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // 진행 중이면 빨리(6s), 안정(통과/실패/없음)이면 느리게(30s) 폴링 — 반응 지연 최소화.
    const tick = async () => {
      let next: CiDot = null;
      try {
        const r = await gh.checks(root);
        if (!alive) return;
        if (r.ok && r.data && !r.data.noPr && !(r.data.state && r.data.state.toUpperCase() !== "OPEN")) {
          const s = summarize(normalizeChecks(r.data.statusCheckRollup));
          next = !s.total ? null : s.pending > 0 ? "running" : s.fail > 0 ? "failure" : "success";
        }
      } catch { /* 네트워크 등 실패 → 도트 숨김 */ }
      if (!alive) return;
      setDot(next);
      timer = setTimeout(tick, next === "running" ? 6000 : 30000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [root]);
  return dot;
}
