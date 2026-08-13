"use client";

// 레포 탭 아이콘(#777) — 그 레포의 GitHub owner(조직/개인) 프로필 아바타를 원형으로.
// owner는 /api/repo/git-remote로 1회 조회 후 캐시(모듈 Map + localStorage). owner 없음(로컬·
// 비GitHub)·이미지 로드 실패 시 기존 문서 아이콘(IconFiles)으로 폴백.
import { useEffect, useState } from "react";
import { IconFiles } from "@tabler/icons-react";

// path → owner. undefined=미조회, null=owner 없음(폴백), string=owner. git remote는 안 바뀌므로 영속 캐시.
const ownerCache = new Map<string, string | null>();
function cacheGet(path: string): string | null | undefined {
  if (ownerCache.has(path)) return ownerCache.get(path);
  try {
    const v = localStorage.getItem(`nunopi:repo-owner:${path}`);
    if (v !== null) { const o = v === "" ? null : v; ownerCache.set(path, o); return o; }
  } catch { /* ignore */ }
  return undefined;
}
function cacheSet(path: string, owner: string | null) {
  ownerCache.set(path, owner);
  try { localStorage.setItem(`nunopi:repo-owner:${path}`, owner ?? ""); } catch { /* ignore */ }
}

export default function RepoAvatar({ path, size, iconClassName }: { path: string; size: number; iconClassName?: string }) {
  const [owner, setOwner] = useState<string | null | undefined>(() => cacheGet(path));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (owner !== undefined) return; // 캐시 히트 → 조회 안 함
    let alive = true;
    fetch("/api/repo/git-remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; const o = (j?.owner as string | null) ?? null; cacheSet(path, o); setOwner(o); })
      .catch(() => { if (alive) setOwner(null); });
    return () => { alive = false; };
  }, [path, owner]);

  if (owner && !failed) {
    return (
      // size*3 = 레티나 대응. 실패(404·오프라인)면 IconFiles로 폴백.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`https://github.com/${owner}.png?size=${size * 3}`} alt="" aria-hidden
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    );
  }
  return <IconFiles size={size} stroke={2} className={iconClassName} aria-hidden />;
}
