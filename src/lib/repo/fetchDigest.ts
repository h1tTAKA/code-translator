// 아키텍처 분석 그래프 다이제스트 조회(#842 서브3) — 클라이언트 공용.
// 분석·플로우 프롬프트에 실측 구조를 덧대는 용도. 실패 시 null → 호출부는 기존(파일목록만)으로 폴백.
export async function fetchGraphDigest(root: string): Promise<string | null> {
  try {
    const r = await fetch("/api/repo/codegraph/digest", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }),
    });
    const d = await r.json().catch(() => null);
    return r.ok && typeof d?.digest === "string" && d.digest.trim() ? d.digest : null;
  } catch { return null; }
}
