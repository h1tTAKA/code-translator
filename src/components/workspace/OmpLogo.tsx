// oh-my-pi(OMP) 공식 마크(#864) — 레포 assets/icon.svg 기반. π 기호 + 주황 플러그 커넥터.
// π 막대는 currentColor로(원본 흰색은 라이트 배경서 안 보임 → 탭 글자색 적응), 커넥터는 브랜드 주황 유지.
export default function OmpLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 90" aria-hidden>
      <rect x="10" y="8" width="100" height="12" rx="2" fill="currentColor" />
      <rect x="25" y="20" width="12" height="62" rx="2" fill="currentColor" />
      <rect x="75" y="20" width="12" height="45" rx="2" fill="currentColor" />
      <rect x="71" y="55" width="20" height="16" rx="3" fill="#f97316" />
      <rect x="76" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <rect x="82" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <circle cx="18" cy="14" r="2" fill="#f97316" opacity="0.8" />
      <circle cx="102" cy="14" r="2" fill="#f97316" opacity="0.8" />
    </svg>
  );
}
