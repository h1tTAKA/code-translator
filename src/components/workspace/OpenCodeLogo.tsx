// OpenCode 공식 마크(#864) — 유저 제공 SVG(데스크톱 opencode-logo). 사각 프레임 + 내부 하단 블록.
// currentColor로 렌더해 탭 글자색을 따라감(라이트·다크 양쪽 가시). 프레임=진하게, 내부 블록=옅게.
export default function OpenCodeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 300" fill="none" aria-hidden>
      <path d="M180 240H60V120H180V240Z" fill="currentColor" fillOpacity={0.4} />
      <path fillRule="evenodd" clipRule="evenodd" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
    </svg>
  );
}
