// 레포 그래프 그룹(폴더) 색 — 그래프 뷰·필터 칩 공유.
export const REPO_PALETTE = ["#3B34E2", "#0ea5e9", "#10b981", "#d946ef", "#f59e0b", "#f43f5e", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16"];
export const REPO_NODE_FALLBACK = "#71717a";

// 그룹 이름 목록 → 그룹→색 Map(팔레트 순환).
export function groupColors(groups: string[]): Map<string, string> {
  return new Map(groups.map((g, i) => [g, REPO_PALETTE[i % REPO_PALETTE.length]]));
}

// 커뮤니티 id → 색(팔레트 순환). id는 크기순 0,1,2...라 큰 커뮤니티가 안정된 색.
export function communityColor(id: number): string {
  return REPO_PALETTE[id % REPO_PALETTE.length];
}

// #rrggbb → rgba(r,g,b,a). 폴더 구역 tint/경계/라벨 알파 조절용.
// 전제: REPO_PALETTE·REPO_NODE_FALLBACK 모두 6자리 hex(#rrggbb). 아니면 원본 반환(안전).
export function hexToRgba(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
