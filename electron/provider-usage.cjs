// Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735) — Orca rate-limits fetcher 방식.
// 로컬 크레덴셜(accessToken)을 읽어 각 provider의 usage 엔드포인트를 호출한다.
// per-request 토큰이 아니라 "한도 윈도우 %·리셋 시간". main에서만(파일 접근·CORS 회피). 토큰은 읽기만.
const { readFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { net } = require("electron");
const execFileAsync = promisify(execFile);

const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TIMEOUT_MS = 10_000;

// resets_at 단위 판별: >1e10이면 이미 ms epoch, 아니면 초 epoch(×1000). (Orca와 동일 휴리스틱)
function parseResetTs(v) {
  if (typeof v === "number") return Number.isFinite(v) ? (v > 1e10 ? v : v * 1000) : null;
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return n > 1e10 ? n : n * 1000;
  const p = new Date(v).getTime();
  return Number.isNaN(p) ? null : p;
}

function resetLabel(ts) {
  if (ts == null) return null;
  try {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

// 다양한 필드명(utilization/used_percentage/used_percent, resets_at/reset_at) 수용.
function mapWindow(raw, windowMinutes) {
  if (!raw || typeof raw !== "object") return null;
  const pct =
    typeof raw.utilization === "number" ? raw.utilization
    : typeof raw.used_percentage === "number" ? raw.used_percentage
    : typeof raw.used_percent === "number" ? raw.used_percent
    : null;
  if (pct == null) return null;
  const resetsAt = parseResetTs(raw.resets_at ?? raw.reset_at);
  return { usedPercent: Math.min(100, Math.max(0, pct)), windowMinutes, resetsAt, resetLabel: resetLabel(resetsAt) };
}

// Electron net.fetch — main에서 OS 프록시/인증서 스택 사용(Node 전역 fetch보다 견고). app ready 후 호출됨.
async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return { error: `http-${res.status}` };
    return { data: await res.json() };
  } catch {
    return { error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function extractClaudeAccessToken(raw) {
  try {
    const j = JSON.parse(raw);
    const tok = j?.claudeAiOauth?.accessToken;
    return typeof tok === "string" && tok.trim() ? tok : null;
  } catch {
    return null;
  }
}

// macOS는 Claude Code 크레덴셜을 키체인(service "Claude Code-credentials")에 저장 — 파일이 없을 때 폴백.
async function readClaudeTokenFromKeychain() {
  if (process.platform !== "darwin") return null;
  try {
    const user = process.env.USER || process.env.USERNAME || "user";
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-a", user, "-w"], { timeout: 5000 });
    return extractClaudeAccessToken(stdout.trim());
  } catch {
    return null;
  }
}

async function readClaudeToken() {
  try {
    const raw = await readFile(join(homedir(), ".claude", ".credentials.json"), "utf8");
    const fromFile = extractClaudeAccessToken(raw);
    if (fromFile) return fromFile;
  } catch { /* 파일 없음 → 키체인 시도 */ }
  return readClaudeTokenFromKeychain();
}

// 401/403 = 인증 만료·무효 → "로그인 필요"(unavailable), 그 외 = error.
function statusForError(error) {
  return error === "http-401" || error === "http-403" ? "unavailable" : "error";
}

async function fetchClaudeUsage() {
  const token = await readClaudeToken();
  if (!token) return { provider: "claude", status: "unavailable" };
  const { data, error } = await fetchJson(CLAUDE_OAUTH_USAGE_URL, {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.0",
  });
  if (error) return { provider: "claude", status: statusForError(error) };
  if (!data) return { provider: "claude", status: "error" };
  // Fable 주간: 응답 필드명이 여러 형태 → 순차 폴백.
  const fableWeekly = mapWindow(data.fable_weekly, 10080) ?? mapWindow(data.fable_seven_day, 10080) ?? mapWindow(data.seven_day_fable, 10080) ?? null;
  return {
    provider: "claude",
    status: "ok",
    session: mapWindow(data.five_hour, 300),
    weekly: mapWindow(data.seven_day, 10080),
    fableWeekly,
  };
}

async function readCodexAuth() {
  try {
    const home = process.env.CODEX_HOME || join(homedir(), ".codex");
    const raw = await readFile(join(home, "auth.json"), "utf8");
    const j = JSON.parse(raw);
    const token = j?.tokens?.access_token;
    const accountId = j?.tokens?.account_id;
    return typeof token === "string" && token.trim() ? { token, accountId: typeof accountId === "string" ? accountId : null } : null;
  } catch {
    return null;
  }
}

async function fetchCodexUsage() {
  const auth = await readCodexAuth();
  if (!auth) return { provider: "codex", status: "unavailable" };
  // Codex 백엔드가 요구하는 헤더(Orca와 동일) — 없으면 인증돼도 거부될 수 있음.
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    "User-Agent": "codex-cli",
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
  const { data, error } = await fetchJson(CODEX_USAGE_URL, headers);
  if (error) return { provider: "codex", status: statusForError(error) };
  if (!data) return { provider: "codex", status: "error" };
  const rl = data.rate_limit ?? data.rateLimits ?? {};
  // primary_window=세션(짧은 창), secondary_window=주간. reset_at은 초 단위(mapWindow가 판별).
  return {
    provider: "codex",
    status: "ok",
    session: mapWindow(rl.primary_window ?? rl.primary, 300),
    weekly: mapWindow(rl.secondary_window ?? rl.secondary, 10080),
  };
}

// 둘 병렬. 개별 실패는 status로 격리(전체 실패로 안 번지게).
async function getProviderUsage() {
  const [claude, codex] = await Promise.all([
    fetchClaudeUsage().catch(() => ({ provider: "claude", status: "error" })),
    fetchCodexUsage().catch(() => ({ provider: "codex", status: "error" })),
  ]);
  return { claude, codex };
}

module.exports = { getProviderUsage };
