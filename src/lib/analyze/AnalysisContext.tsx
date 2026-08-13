"use client";

// 코드/글 분석의 공유 데이터(#773 서브3) — historyEntries·collections·excludedTerms·providerId 등
// 여러 뷰가 함께 쓰는 상태를 소유자(page.tsx)가 Context로 노출한다. 워크스페이스 탭 안의
// CodeAnalysisView는 이 Context에서 공유 상태를 받아 useCodeAnalysis에 주입 → 독립 모드와 같은
// 히스토리·수집 저장소를 본다(유저 의도 "기존 그대로"). 인메모리 입력/결과는 훅 인스턴스별 독립.
import { createContext, useContext, type ReactNode } from "react";
import type { CodeAnalysisShared } from "@/hooks/useCodeAnalysis";

const AnalysisCtx = createContext<CodeAnalysisShared | null>(null);

export function AnalysisProvider({ value, children }: { value: CodeAnalysisShared; children: ReactNode }) {
  return <AnalysisCtx.Provider value={value}>{children}</AnalysisCtx.Provider>;
}

export function useAnalysisContext(): CodeAnalysisShared {
  const v = useContext(AnalysisCtx);
  if (!v) throw new Error("useAnalysisContext must be used within AnalysisProvider");
  return v;
}
