// Cursor 공식 로고(#803) — icons8 벡터 큐브 이식(멀티톤 그레이, 밝은 면 있어 다크 배경서도 보임). 인라인이라 CSP 안전.
export default function CursorLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden style={{ fillRule: "evenodd", clipRule: "evenodd" }}>
      <polygon fill="#bcbcbc" points="23.974,4 6.97,14 6.97,34 23.998,44 40.97,34 40.97,14" />
      <line x1="7.97" x2="23.579" y1="33" y2="24.454" fill="none" stroke="#bcbcbc" strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit="10" strokeWidth="2" />
      <line x1="23.972" x2="23.966" y1="5.903" y2="15.864" fill="none" stroke="#bcbcbc" strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit="10" strokeWidth="2" />
      <line x1="39.97" x2="32.97" y1="33" y2="29" fill="none" stroke="#bcbcbc" strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit="10" strokeWidth="2" />
      <polygon fill="#757575" points="23.974,4 6.97,14 6.97,34 23.97,24" />
      <polygon fill="#424242" points="23.981,14 40.97,14 40.97,34 23.971,24" />
      <polygon fill="#616161" points="40.97,14 23.966,17 23.974,4" />
      <polygon fill="#616161" points="6.97,14 23.981,16.881 23.966,24 6.97,34" />
      <polygon fill="#ededed" points="6.97,14 23.97,24 23.998,44 40.97,14" />
    </svg>
  );
}
