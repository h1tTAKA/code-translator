// GitHub 패널(#809) gh CLI 브릿지(#810) — gh를 execFile(no-shell)로 실행하는 단일 창구 + 인증 진단.
// orca(stablyai/orca) src/main/github(gh-utils·auth-diagnose) 방식 채택: 유저 기존 gh auth 사용, --json 구조화.
// 서브3~5(checks/이슈/PR)는 이 헬퍼에 args만 조립해 재사용한다.
const { execFile } = require("node:child_process");
const { existsSync, statSync } = require("node:fs");
const { promisify } = require("node:util");
const pexecFile = promisify(execFile);

// gh 에러 분류 — UI가 "설치 필요/인증 필요/rate limit" 등 안내를 그릴 수 있게.
function classifyGhError(e) {
  if (e?.code === "ENOENT") return { kind: "not-installed", detail: "gh(GitHub CLI)를 찾을 수 없음" };
  const s = String(e?.stderr || e?.message || "").toLowerCase();
  if (/auth login|not logged|authentication|gh auth|no accounts/.test(s)) return { kind: "not-authed", detail: "gh 인증 필요 — 터미널에서 `gh auth login`" };
  if (/rate limit|api rate|\b403\b/.test(s)) return { kind: "rate-limited", detail: "GitHub API rate limit — 잠시 후 재시도" };
  const line = (String(e?.stderr || e?.message || "").split("\n").find((l) => l.trim()) || "gh 실행 오류").trim();
  return { kind: "error", detail: line.slice(0, 300) };
}

// gh 원시 실행. cwd=레포 디렉터리, args=배열(no-shell). 성공 { ok, stdout } | 실패 { ok:false, kind, detail }.
async function ghRun({ gh, cwd, args, timeout = 15000 }) {
  // cwd 없음/비디렉터리면 execFile이 ENOENT를 던져 gh 미설치로 오분류됨 → 먼저 걸러 error로.
  if (cwd && (!existsSync(cwd) || !statSync(cwd).isDirectory())) return { ok: false, kind: "error", detail: "작업 디렉터리를 찾을 수 없음" };
  try {
    const { stdout } = await pexecFile(gh || "gh", args, { cwd, timeout, maxBuffer: 10_000_000 });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, ...classifyGhError(e) };
  }
}

// gh --json 실행 후 파싱. 성공 { ok, data } | 실패 { ok:false, kind, detail }. (호출부가 args에 --json,필드 포함)
async function ghJson({ gh, cwd, args }) {
  const r = await ghRun({ gh, cwd, args });
  if (!r.ok) return r;
  try { return { ok: true, data: JSON.parse(r.stdout || "null") }; }
  catch { return { ok: false, kind: "error", detail: "gh --json 출력 파싱 실패" }; }
}

// 인증 진단 — { state: "ok"|"not-installed"|"not-authed"|"rate-limited"|"error", detail? }.
async function authDiagnose({ gh, cwd }) {
  const r = await ghRun({ gh, cwd, args: ["auth", "status"], timeout: 8000 });
  if (r.ok) return { state: "ok" };
  return { state: r.kind, detail: r.detail };
}

module.exports = { ghRun, ghJson, authDiagnose, classifyGhError };
