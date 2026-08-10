"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// CJK 강조 버그 보정: 닫는 `*`/`**` 앞이 ASCII 문장부호이고 바로 뒤가 한글/가나/한자면
// CommonMark flanking 규칙상 강조가 안 닫혀 `**`가 리터럴로 남는다(예: `**A (a.ts)**는`).
// 부호와 별표 사이에 제로폭공백(U+200B)을 끼우면 flanking을 통과해 정상 볼드/이탤릭이 된다(보이지 않음).
const CJK_EMPHASIS = /([)\]}>.,!?%:;"'’”》」』])(\*{1,2})(?=[가-힣぀-ヿ一-鿿])/g;
const ZWSP = "​"; // 제로폭 공백(보이지 않음)
const fixCjkEmphasis = (s: string) => s.replace(CJK_EMPHASIS, `$1${ZWSP}$2`);

// 챗/카드설명 답변을 마크다운으로 렌더(GFM 표 포함). raw HTML은 렌더하지 않아 안전.
// 코드펜스는 rehype-highlight(highlight.js)로 신택스 하이라이팅(테마는 globals.css의 hljs).
// detect: 언어 태그 없는 펜스(``` 만)도 자동 감지해 하이라이팅 — 모델 출력의 언어 표기가
// 들쭉날쭉해도 색이 입혀진다. (미등록 언어 태그는 rehype-highlight v7이 에러 없이 스킵 — 기본 동작.)
// 스타일은 globals.css의 .nunopi-md로 스코프한다(표/코드/목록/제목/링크 등).
export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `nunopi-md ${className}` : "nunopi-md"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]}>
        {fixCjkEmphasis(children)}
      </ReactMarkdown>
    </div>
  );
}
