// register 병합 점검 — node --experimental-strip-types src/lib/repo/mcp/register.check.ts
import assert from "node:assert";
import { mergeClaudeDoc, mergeCodexToml, MCP_NAME } from "./register.ts";

const spec = { command: "/usr/bin/node", args: ["/app/bridge.cjs", "/repo", "http://127.0.0.1:3000"] };

// Claude: 기존 서버 보존 + 우리 항목 추가
const merged = mergeClaudeDoc({ mcpServers: { other: { command: "x" } }, extra: 1 }, spec);
assert.ok(merged.mcpServers.other, "기존 other 서버 보존");
assert.deepEqual((merged.mcpServers[MCP_NAME] as { args: string[] }).args, spec.args, "우리 항목 args");
assert.equal((merged as { extra?: number }).extra, 1, "다른 최상위 키 보존");
// 재실행(갱신) 시 중복 안 생김
const again = mergeClaudeDoc(merged, spec);
assert.equal(Object.keys(again.mcpServers).length, 2, "갱신해도 서버 2개(중복 X)");
// 빈/손상 입력
assert.ok(mergeClaudeDoc(null, spec).mcpServers[MCP_NAME], "null 입력도 생성");

// Codex: 기존 섹션 보존 + append
const existing = `[mcp_servers.foo]\ncommand = "foo"\n`;
const t1 = mergeCodexToml(existing, spec);
assert.ok(t1.includes("[mcp_servers.foo]"), "기존 foo 섹션 보존");
assert.ok(t1.includes(`[mcp_servers.${MCP_NAME}]`), "우리 섹션 추가");
assert.ok(t1.includes('"/repo"'), "레포 경로 인자 포함");
// 재실행 — 우리 섹션 교체(중복 X)
const t2 = mergeCodexToml(t1, spec);
assert.equal((t2.match(new RegExp(`\\[mcp_servers\\.${MCP_NAME}\\]`, "g")) || []).length, 1, "우리 섹션 1개(중복 X)");
assert.ok(t2.includes("[mcp_servers.foo]"), "재실행 후에도 foo 보존");
// 빈 입력
assert.ok(mergeCodexToml("", spec).includes(`[mcp_servers.${MCP_NAME}]`), "빈 입력도 생성");

console.log("register.check OK");
