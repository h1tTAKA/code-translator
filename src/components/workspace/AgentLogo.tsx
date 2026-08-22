// 에이전트 브랜드 로고 + 프로세스명 식별(#764) — 레포탭 호버 카드에서 "어떤 에이전트가 도는가"를 아이콘으로.
// 잘 알려진 에이전트는 인라인 브랜드 마크(CSP 안전), 그 외 알려진 에이전트는 브랜드색 모노그램. 셸/미지 프로세스는 에이전트 아님.

import CodexLogo from "@/components/workspace/CodexLogo";
import AntigravityLogo from "@/components/workspace/AntigravityLogo";
import HermesLogo from "@/components/workspace/HermesLogo";
import CursorLogo from "@/components/workspace/CursorLogo";

export type AgentId = "claude" | "codex" | "gemini" | "antigravity" | "hermes" | "aider" | "opencode" | "cursor" | "copilot" | "amp" | "grok" | "other";

// 프로세스명 → 에이전트 매칭. foreground 프로세스명(node-pty proc.process)에 대해 검사.
const MATCH: [AgentId, RegExp][] = [
  ["claude", /claude/i],
  ["codex", /codex/i],
  ["gemini", /gemini/i],
  ["antigravity", /antigravity/i],
  ["hermes", /hermes/i],
  ["aider", /aider/i],
  ["opencode", /open-?code/i],
  ["cursor", /cursor/i],
  ["copilot", /copilot/i],
  ["amp", /^amp$/i],
  ["grok", /grok/i],
];

// 셸 프로세스명(유휴 상태 — 에이전트 안 돎). 선행 "-"(login shell) 정규화 후 비교.
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "pwsh", "powershell", "cmd", "login", "screen", "tmux"]);

function norm(processName: string | undefined): string {
  return (processName || "").trim().toLowerCase().replace(/^-+/, "");
}

// 알려진 에이전트면 그 id, 아니면 null(셸이든 다른 프로세스든). 카드가 null을 "유휴/기타"로 분기.
export function identifyAgent(processName: string | undefined): AgentId | null {
  const p = norm(processName);
  if (!p) return null;
  for (const [id, re] of MATCH) if (re.test(p)) return id;
  return null;
}

// 셸(프롬프트 대기 = 유휴)인가.
export function isShellProcess(processName: string | undefined): boolean {
  return SHELLS.has(norm(processName));
}

export const AGENT_META: Record<AgentId, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#D97757" },   // Anthropic coral
  codex: { label: "Codex", color: "#7C6BF5" },     // Codex 앱 블루퍼플
  gemini: { label: "Gemini", color: "#4285F4" },   // Google blue
  antigravity: { label: "Antigravity", color: "#1A73E8" }, // Google Antigravity blue
  hermes: { label: "Hermes", color: "#C026D3" },   // Nous Hermes magenta
  aider: { label: "Aider", color: "#14B8A6" },
  opencode: { label: "OpenCode", color: "#F59E0B" },
  cursor: { label: "Cursor", color: "#6B7280" },
  copilot: { label: "Copilot", color: "#8B5CF6" },
  amp: { label: "Amp", color: "#F97316" },
  grok: { label: "Grok Build", color: "#9CA3AF" },  // 중립 그레이(흑백 브랜드 — 양 테마서 보이게)
  other: { label: "Agent", color: "#6B7280" },
};

// 에이전트 브랜드 마크. claude/gemini/codex는 인라인 마크, 그 외는 브랜드색 모노그램 원형.
export function AgentLogo({ agent, size = 14 }: { agent: AgentId; size?: number }) {
  const c = AGENT_META[agent]?.color ?? "#6B7280";
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (agent === "claude") {
    // Anthropic 선버스트 — 중심에서 12방향 광선.
    return (
      <svg {...common}>
        <g stroke={c} strokeWidth={1.9} strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map((deg) => {
            const a = (deg * Math.PI) / 180, dx = Math.cos(a) * 10.6, dy = Math.sin(a) * 10.6;
            return <line key={deg} x1={12 - dx} y1={12 - dy} x2={12 + dx} y2={12 + dy} />;
          })}
        </g>
      </svg>
    );
  }
  if (agent === "gemini") {
    // Gemini 4점 스파클.
    return <svg {...common}><path d="M12 2c.4 5.3 4.3 9.6 10 10-5.7.4-9.6 4.3-10 10-.4-5.7-4.3-9.6-10-10 5.7-.4 9.6-4.3 10-10z" fill={c} /></svg>;
  }
  if (agent === "codex") return <CodexLogo size={size} />;    // 공식 로고(#803)
  if (agent === "antigravity") return <AntigravityLogo size={size} />;   // 공식 로고(#803)
  if (agent === "hermes") return <HermesLogo size={size} />;   // 공식 로고(#803, currentColor)
  if (agent === "cursor") return <CursorLogo size={size} />;   // 공식 로고(#803, PNG 에셋)
  if (agent === "grok") {
    // Grok(xAI) 공식 로고 — 단일 path·currentColor(탭 글자색 따라감, 양 테마 가시).
    return <svg {...common} fill="currentColor" style={{ fillRule: "evenodd" }}><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" /></svg>;
  }
  // 그 외 알려진 에이전트 — 브랜드색 원형 + 첫 글자 모노그램.
  const label = AGENT_META[agent]?.label ?? "A";
  return (
    <svg {...common}>
      <circle cx={12} cy={12} r={9} fill="none" stroke={c} strokeWidth={1.6} />
      <text x={12} y={16} textAnchor="middle" fontSize={11} fontWeight={700} fill={c}>{label[0]}</text>
    </svg>
  );
}
