"use client";

// 창 전체화면 상태(#779) — 신호등 자리 좌측 패딩을 토글하려고 electron main의 fullscreen을 구독.
// 웹(비데스크톱)이면 항상 false. 마운트 시 초기 상태 조회 + 변경 구독.
import { useEffect, useState } from "react";

export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const w = window.nunopiDesktop?.window;
    if (!w) return;
    w.isFullscreen().then((v) => setFullscreen(Boolean(v))).catch(() => {});
    return w.onFullscreen((v) => setFullscreen(Boolean(v)));
  }, []);
  return fullscreen;
}
