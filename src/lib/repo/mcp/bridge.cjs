#!/usr/bin/env node
// 코드그래프 MCP stdio 브릿지(#853) — 손수 JSON-RPC 2.0(SDK 없음, Graft 모델).
// 에이전트 CLI가 spawn. 툴 실행은 우리 앱의 Next 라우트(/api/repo/mcp/tool)로 위임 → lib 해석 문제 0.
// stdout=프로토콜 전용(로그는 stderr). 앱이 떠 있어야 동작(에이전트는 앱 터미널서 돌므로 항상 켜짐).
//
// 실행: node bridge.cjs <repoRoot> <appUrl>
//   또는 env: NUNOPI_REPO, NUNOPI_APP_URL(기본 http://127.0.0.1:3000)
const readline = require("node:readline");

const ROOT = process.argv[2] || process.env.NUNOPI_REPO || process.cwd();
const APP = (process.argv[3] || process.env.NUNOPI_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const TOOL_URL = `${APP}/api/repo/mcp/tool`;
const VERSION = "0.1.0";

function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

let toolsCache = null; // {name,description,inputSchema}[]
async function fetchTools() {
  if (toolsCache) return toolsCache;
  try {
    const r = await fetch(TOOL_URL, { method: "GET" });
    const d = await r.json();
    toolsCache = Array.isArray(d?.tools) ? d.tools : [];
  } catch (e) { console.error(`[nunopi-mcp] tools/list fetch failed: ${e?.message || e}`); toolsCache = []; }
  return toolsCache;
}
async function runTool(name, args) {
  const r = await fetch(TOOL_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: ROOT, name, args: args || {} }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(d?.error || `HTTP ${r.status} — 앱이 실행 중인지 확인`);
  return { text: String(d.text ?? ""), isError: !!d.isError };
}

// in-flight 조회 추적 — stdin이 닫혀도 진행 중 응답을 잃지 않게 drain 후 종료.
let pending = 0, ending = false;
function done() { pending--; if (ending && pending === 0) process.exit(0); }

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { replyError(null, -32700, "parse error"); return; }
  const { id, method, params } = msg;
  const isNotification = id === undefined;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nunopi-codegraph", version: VERSION },
        instructions: "nunopi 코드그래프 툴. 파일을 뒤지기 전에 nunopi_repo_map으로 구조를 먼저 잡고, find_code/trace_calls/find_all/file_api/search로 정확히 짚어라.",
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      if (!isNotification) reply(id, {});
      return;
    case "tools/list":
      if (isNotification) return;
      pending++;
      fetchTools().then((tools) => reply(id, { tools })).finally(done);
      return;
    case "tools/call": {
      if (isNotification) return;
      const name = String(params?.name || "");
      const args = params?.arguments || {};
      pending++;
      runTool(name, args).then(
        (r) => reply(id, { content: [{ type: "text", text: r.text }], isError: r.isError }),
        (err) => reply(id, { content: [{ type: "text", text: String(err?.message || err) }], isError: true }),
      ).finally(done);
      return;
    }
    default:
      if (!isNotification) replyError(id, -32601, `method not found: ${method}`);
  }
});
// stdin 닫히면: 진행 중 조회 있으면 drain 후 종료, 없으면 즉시. 안전 타임아웃 10s.
process.stdin.on("end", () => { ending = true; if (pending === 0) process.exit(0); setTimeout(() => process.exit(0), 10000).unref?.(); });
console.error(`[nunopi-mcp] bridge ready — repo ${ROOT} via ${APP}`);
