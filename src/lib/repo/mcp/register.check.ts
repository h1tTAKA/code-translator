// register 병합 점검 — node --experimental-strip-types src/lib/repo/mcp/register.check.ts
import assert from "node:assert";
import { mergeClaudeDoc, mergeCodexToml, mergeRuleDoc, ruleSnippet, MCP_NAME } from "./register.ts";

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

// 핵심: 우리 섹션 뒤에 다른 테이블이 오고, 우리 args가 [배열]일 때 재실행해도 orphan/중복 안 생김.
const withNext = `[mcp_servers.${MCP_NAME}]\ncommand = "old"\nargs = ["/x", "/y"]\n\n[other.table]\nk = 1\n`;
const re2 = mergeCodexToml(withNext, spec);
assert.equal((re2.match(/args = \[/g) || []).length, 1, "args 한 줄만(orphan 배열 없음)");
assert.ok(re2.includes("[other.table]") && re2.includes("k = 1"), "뒤 테이블 보존");
assert.ok(!re2.includes('"old"'), "옛 command 교체됨");
assert.ok(re2.includes('"/repo"'), "새 args 반영");

// 룰 파일 마커 병합 — 기존 내용 보존 + 우리 블록만, 재실행 중복 없음
const snip = ruleSnippet();
const existingMd = "# My Project\n\n프로젝트 설명입니다.\n";
const r1 = mergeRuleDoc(existingMd, snip);
assert.ok(r1.includes("# My Project") && r1.includes("프로젝트 설명입니다."), "기존 CLAUDE.md 내용 보존");
assert.ok(r1.includes("katchup_repo_map"), "룰 스니펫 추가");
// 재실행 → 블록 1개(중복 없음)
const r2 = mergeRuleDoc(r1, snip);
assert.strictEqual((r2.match(/nunopi:katchup:start/g) || []).length, 1, "마커 블록 1개(재실행 중복 X)");
assert.ok(r2.includes("# My Project"), "재실행에도 기존 보존");
// 빈 파일
assert.ok(mergeRuleDoc("", snip).includes("katchup_trace_calls"), "빈 파일도 생성");

console.log("register.check OK");
