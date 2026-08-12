// Claude Code 상태 훅 주입(#764) — nunopi가 여는 레포의 .claude/settings.local.json에 상태 훅을 병합한다.
// 훅은 우리 헬퍼(node)를 실행해 "현재 nunopi 엔드포인트"(엔드포인트 파일에서 읽음 — 포트 변동 대응)로 상태를 POST.
// 원칙: 기존 설정·타 훅 보존, 마커로 중복 방지, claude 절대 안 깨짐(헬퍼는 실패해도 항상 exit 0).
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const HELPER_NAME = "nunopi-agent-hook.cjs";
const ENDPOINT_NAME = "nunopi-agent-endpoint.txt";

const helperPath = (userData) => join(userData, HELPER_NAME);
const endpointPath = (userData) => join(userData, ENDPOINT_NAME);

// 헬퍼 소스 — 엔드포인트 파일 경로를 박아 런타임에 현재 URL을 읽는다(설정 파일엔 URL 미포함 → stale 방지).
function helperSrc(endpointFile) {
  return `// nunopi 에이전트 상태 훅 헬퍼(#764) — 자동 생성. Claude Code 훅이 'node <this> <event>'로 실행.
// stdin=훅 JSON, argv[2]=event. 현재 nunopi 엔드포인트를 파일에서 읽어 상태 POST. 항상 exit 0(claude 방해 금지).
const fs = require("node:fs");
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("error", () => process.exit(0));
process.stdin.on("end", async () => {
  try {
    const event = process.argv[2];
    let url = ""; try { url = fs.readFileSync(${JSON.stringify(endpointFile)}, "utf8").trim(); } catch (e) {}
    if (!event || !url || typeof fetch !== "function") return process.exit(0);
    let j = {}; try { j = JSON.parse(raw || "{}"); } catch (e) {}
    const body = { event, cwd: j.cwd || process.cwd(), sessionId: j.session_id || "", agent: "claude", tool: j.tool_name, toolInput: j.tool_input, prompt: j.prompt };
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  } catch (e) {}
  process.exit(0);
});
setTimeout(() => process.exit(0), 4000);
`;
}

// 부팅 1회 — 헬퍼 스크립트 기록.
function writeHookHelper(userData) {
  try { writeFileSync(helperPath(userData), helperSrc(endpointPath(userData))); return true; }
  catch (e) { console.warn("[agent-hooks] helper write failed:", String(e)); return false; }
}

// 부팅(+URL 확정) 시 — 현재 nunopi 엔드포인트 기록. 헬퍼가 이 파일을 읽으므로 포트가 바뀌어도 자동 반영.
function writeEndpoint(userData, appBase) {
  try { writeFileSync(endpointPath(userData), `${appBase}/api/agent/status`); return true; }
  catch (e) { console.warn("[agent-hooks] endpoint write failed:", String(e)); return false; }
}

// 우리 훅 command(마커 겸용) — 이벤트별.
function hookCommand(userData, event) {
  return `node ${JSON.stringify(helperPath(userData))} ${event}`;
}

// event → settings 엔트리. tool 이벤트는 matcher(""=전체) 포함, 나머지는 matcher 없음.
function buildBlock(userData) {
  const entry = (event, matcher) => {
    const h = { hooks: [{ type: "command", command: hookCommand(userData, event) }] };
    if (matcher !== undefined) h.matcher = matcher;
    return h;
  };
  return {
    UserPromptSubmit: [entry("UserPromptSubmit")],
    PreToolUse: [entry("PreToolUse", "")],
    PostToolUse: [entry("PostToolUse", "")],
    Notification: [entry("Notification")],
    Stop: [entry("Stop")],
  };
}

// cwd 레포의 .claude/settings.local.json에 상태 훅 병합(idempotent). 기존 값·타 훅 보존.
function ensureRepoHooks(cwd, userData) {
  try {
    if (!cwd) return;
    const marker = helperPath(userData); // 우리 command 식별자
    const dir = join(cwd, ".claude");
    const file = join(dir, "settings.local.json");
    let settings = {};
    try { const s = JSON.parse(readFileSync(file, "utf8")); if (s && typeof s === "object") settings = s; } catch (e) { /* 없거나 깨짐 → 새로 */ }
    if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
    const hooks = settings.hooks;
    const block = buildBlock(userData);
    let changed = false;
    for (const event of Object.keys(block)) {
      if (!Array.isArray(hooks[event])) hooks[event] = [];
      const arr = hooks[event];
      const has = arr.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(marker)));
      if (!has) { arr.push(...block[event]); changed = true; }
    }
    if (changed) { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(settings, null, 2) + "\n"); }
  } catch (e) { console.warn("[agent-hooks] ensureRepoHooks failed:", String(e)); }
}

module.exports = { writeHookHelper, writeEndpoint, ensureRepoHooks };
