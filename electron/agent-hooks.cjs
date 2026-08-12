// 에이전트 상태 훅 정리(#765) — #764에서 레포 .claude/settings.local.json에 심었던 상태 훅을 제거한다.
// 버퍼 스크레이핑(#765)이 훅을 대체하므로 더는 주입하지 않고, 레포를 다시 열 때(terminal:ensure)
// 예전에 심어둔 우리 훅 블록만 골라 지운다(기존 설정·타 훅은 보존). 부작용(레포 파일 오염) 되돌림.
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const HELPER_NAME = "nunopi-agent-hook.cjs";
// 우리가 심은 훅 command에 박혀 있던 마커(헬퍼 절대경로). 이걸 포함한 훅 엔트리만 제거 대상.
const helperMarker = (userData) => join(userData, HELPER_NAME);

function removeRepoHooks(cwd, userData) {
  try {
    if (!cwd) return;
    const marker = helperMarker(userData);
    const file = join(cwd, ".claude", "settings.local.json");
    let settings;
    try { const s = JSON.parse(readFileSync(file, "utf8")); if (!s || typeof s !== "object") return; settings = s; }
    catch { return; } // 파일 없거나 깨짐 → 지울 것 없음
    if (!settings.hooks || typeof settings.hooks !== "object") return;
    let changed = false;
    for (const event of Object.keys(settings.hooks)) {
      const arr = settings.hooks[event];
      if (!Array.isArray(arr)) continue;
      const kept = arr.filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(marker))));
      if (kept.length !== arr.length) { changed = true; if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event]; }
    }
    if (!changed) return;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks; // 빈 hooks 컨테이너 정리
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  } catch (e) { console.warn("[agent-hooks] removeRepoHooks failed:", String(e)); }
}

module.exports = { removeRepoHooks };
