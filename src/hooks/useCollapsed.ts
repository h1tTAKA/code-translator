"use client";

// 왼쪽 패널 접힘 상태(#781 editor · #783 세션) — 헤더 토글이 접힘을 표시·토글하려면 상태를
// 본문 밖(page·WorkspaceModePane)이 소유해야 한다. 로직은 "참/거짓 + localStorage 영속 + 토글"로
// editor·session이 동일하고 키만 달라, storageKey를 인자로 받는 범용 훅으로 합쳤다.
import { useCallback, useEffect, useState } from "react";

export function useCollapsed(storageKey: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(storageKey) === "1") setCollapsed(true);
  }, [storageKey]);
  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);
  return [collapsed, toggle];
}
