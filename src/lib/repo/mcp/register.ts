// 에이전트 MCP 설정 생성·주입(#853) — 서버(Node) 전용. 우리 코드그래프 브릿지를 각 CLI 에이전트에 등록.
// 병합 원칙: 기존 설정 보존, 우리 항목(mustard-katchup)만 추가/갱신(덮어쓰기 금지).
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const MCP_NAME = "mustard-katchup";

export interface ServerSpec { command: string; args: string[] }

/** 에이전트가 실행할 명령 — node로 브릿지 스크립트 + 레포경로 + 앱주소. */
export function serverSpec(bridgePath: string, root: string, appUrl: string): ServerSpec {
  return { command: process.execPath, args: [bridgePath, root, appUrl] };
}

// ── Claude Code: 레포 루트 .mcp.json (프로젝트 스코프) ──
// { "mcpServers": { "<name>": { "command", "args" } } }
// 순수 병합 — 기존 mcpServers 보존, 우리 항목만 set.
export function mergeClaudeDoc(existing: unknown, spec: ServerSpec): { mcpServers: Record<string, unknown> } {
  const doc = (existing && typeof existing === "object" ? existing : {}) as { mcpServers?: Record<string, unknown> };
  const servers = doc.mcpServers && typeof doc.mcpServers === "object" ? { ...doc.mcpServers } : {};
  servers[MCP_NAME] = { command: spec.command, args: spec.args };
  return { ...doc, mcpServers: servers };
}
export function writeClaudeMcp(root: string, spec: ServerSpec): { path: string; action: "created" | "updated" } {
  const path = join(root, ".mcp.json");
  let existing: unknown = null;
  const existed = existsSync(path);
  if (existed) { try { existing = JSON.parse(readFileSync(path, "utf8")); } catch { existing = null; } }
  writeFileSync(path, `${JSON.stringify(mergeClaudeDoc(existing, spec), null, 2)}\n`);
  return { path, action: existed ? "updated" : "created" };
}

// ── Codex: ~/.codex/config.toml [mcp_servers.<name>] ──
function tomlEscape(s: string): string { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function codexSection(spec: ServerSpec): string {
  const args = spec.args.map((a) => `"${tomlEscape(a)}"`).join(", ");
  return `[mcp_servers.${MCP_NAME}]\ncommand = "${tomlEscape(spec.command)}"\nargs = [${args}]\n`;
}
// 순수 병합 — 기존 우리 섹션 있으면 그 블록만 교체(다음 [테이블] 또는 EOF까지), 없으면 append. 다른 섹션 보존.
export function mergeCodexToml(existing: string, spec: ServerSpec): string {
  const section = codexSection(spec);
  if (!existing.trim()) return section;
  const re = new RegExp(`(^|\\n)\\[mcp_servers\\.${MCP_NAME}\\][^\\[]*`, "m");
  if (re.test(existing)) return existing.replace(re, (m) => (m.startsWith("\n") ? "\n" : "") + section);
  return existing.replace(/\n*$/, "\n\n") + section;
}
export function writeCodex(spec: ServerSpec): { path: string; action: "created" | "updated" } {
  const path = join(homedir(), ".codex", "config.toml");
  const existed = existsSync(path);
  const prev = existed ? readFileSync(path, "utf8") : "";
  if (!existed) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, mergeCodexToml(prev, spec));
  return { path, action: existed ? "updated" : "created" };
}

export type AgentTarget = "claude" | "codex";

/** 어떤 에이전트 설정 흔적이 있는지 감지(UI 기본 선택 힌트). 없어도 유저가 강제 등록 가능. */
export function detectAgents(root: string): Record<AgentTarget, boolean> {
  const codexDir = join(homedir(), ".codex");
  return {
    claude: existsSync(join(root, ".mcp.json")) || existsSync(join(root, ".claude")) || existsSync(join(homedir(), ".claude")),
    codex: existsSync(codexDir) && statSync(codexDir).isDirectory(),
  };
}

/** 대상별 주입 실행. bridgePath·appUrl은 호출부(라우트)가 해석해 전달. */
export function connectAgents(root: string, targets: AgentTarget[], bridgePath: string, appUrl: string): Array<{ target: AgentTarget; path: string; action: string }> {
  const spec = serverSpec(bridgePath, root, appUrl);
  const out: Array<{ target: AgentTarget; path: string; action: string }> = [];
  for (const t of targets) {
    if (t === "claude") { const r = writeClaudeMcp(root, spec); out.push({ target: t, ...r }); }
    else if (t === "codex") { const r = writeCodex(spec); out.push({ target: t, ...r }); }
  }
  return out;
}
