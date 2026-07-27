// 주석 전용 줄 판정 — 누락 줄 설명 affordance(#635)가 주석 줄에 잘못 뜨는 것 방지.
// 언어 무관 휴리스틱: 코드분석 언어(react/ts/js/css/html)에서 안전한 접두만.
// `#`(TS private 필드)·`--`(감소 연산)·`*ident`(제너레이터 메서드)는 코드일 수 있어 제외 →
// false-negative면 채우기 시 빈 응답으로 우아 처리, false-positive(코드 오판)는 최소화.
export function isCommentOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false; // 빈 줄은 여기서 다루지 않음(호출부에서 별도 처리)
  return (
    t.startsWith("//") ||     // JS/TS/C 한 줄 주석
    t.startsWith("/*") ||     // 블록 주석 시작
    t.startsWith("*/") ||     // 블록 주석 끝
    t.startsWith("<!--") ||   // HTML 주석 시작
    t.startsWith("-->") ||    // HTML 주석 끝
    /^\*(\s|$)/.test(t)       // JSDoc 연속 줄 `* ...` (단, `*ident`·`*(`는 코드라 제외)
  );
}
