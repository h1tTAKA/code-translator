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
    const tick = async () => {
      try {
        const r = await gh.checks(root);
        if (!alive) return;
        if (!r.ok || !r.data || r.data.noPr || (r.data.state && r.data.state.toUpperCase() !== "OPEN")) { setDot(null); return; } // PR 없음/끝남 → 숨김
        const s = summarize(normalizeChecks(r.data.statusCheckRollup));
        setDot(!s.total ? null : s.pending > 0 ? "running" : s.fail > 0 ? "failure" : "success");
      } catch { if (alive) setDot(null); }
    };
    void tick();
    const iv = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [root]);
  return dot;
}
