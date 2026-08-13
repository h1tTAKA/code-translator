"use client";

// 코드/글 분석 입력 패널 접힘(#781) — 스플릿 핸들 화살표 대신 헤더 토글로 옮기며, 상태를
// useCodeAnalysis 훅 밖(page·WorkspaceModePane)으로 끌어올렸다. 헤더 버튼이 접힘을 표시·토글하려면
// 본문과 같은 상태를 상위가 소유해야 하기 때문. localStorage 키는 기존과 동일(하위호환).
import { useCallback, useEffect, useState } from "react";

export function useEditorCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("nunopi:editor-collapsed") === "1") setCollapsed(true);
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("nunopi:editor-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
