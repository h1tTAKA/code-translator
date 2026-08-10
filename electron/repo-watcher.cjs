// 레포 파일 워처(#739) — 워킹트리·.git 변경을 감지해 렌더러에 알림(그래프·변경사항 실시간 갱신).
// macOS/Windows는 fs.watch recursive(FSEvents 등)로 효율적. Linux 등 미지원이면 supported:false → 렌더러 폴백.
const { watch } = require("node:fs");
const { sep } = require("node:path");

const DEBOUNCE_MS = 300;
// 무시할 경로 조각 — git status/log에 안 잡히거나 폭주원(반응하면 낭비). 저장 한 번에 수십 이벤트 방지의 1차 필터.
const IGNORE = ["node_modules", `.git${sep}objects`, `.git${sep}logs`, `.git${sep}lfs`, ".next", "dist", "build", ".DS_Store", ".turbo"];
function ignored(rel) {
  if (!rel) return false;
  return IGNORE.some((frag) => rel.includes(frag));
}

// id(=레포 경로) → { watcher, timer }. 활성 레포당 하나.
const watchers = new Map();

function startWatch(id, root, onChange) {
  stopWatch(id); // 같은 id 재요청 시 이전 것 정리
  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const rel = typeof filename === "string" ? filename : filename ? filename.toString() : "";
      if (ignored(rel)) return;
      const entry = watchers.get(id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      // 디바운스 — 이벤트 폭주를 한 번의 onChange로 묶음.
      entry.timer = setTimeout(() => { entry.timer = null; onChange(); }, DEBOUNCE_MS);
    });
  } catch (e) {
    // recursive 미지원(Linux 등) → 폴백 신호.
    return { ok: false, supported: false, error: String((e && e.message) || e) };
  }
  watcher.on("error", () => {}); // 파일 삭제 등 감시 에러는 조용히
  watchers.set(id, { watcher, timer: null });
  return { ok: true, supported: true };
}

function stopWatch(id) {
  const entry = watchers.get(id);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch { /* ignore */ }
  watchers.delete(id);
}

function stopAll() {
  for (const id of [...watchers.keys()]) stopWatch(id);
}

module.exports = { startWatch, stopWatch, stopAll };
