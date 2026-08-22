"use client";
// GitHub 사용자 아바타(#820) — login → github.com/{login}.png 원형. 실패/없음이면 첫 글자 원.
import { useState } from "react";

export default function GhAvatar({ login, size = 16 }: { login?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size } as const;
  if (!login || failed) {
    return <span style={box} className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{(login || "?")[0]?.toUpperCase()}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- 작은 정적 아바타, next/image 오버킬. github.com 이미지(RepoAvatar와 동일 출처)
  return <img src={`https://github.com/${login}.png?size=${size * 2}`} width={size} height={size} alt="" aria-hidden onError={() => setFailed(true)} style={box} className="shrink-0 rounded-full" />;
}
