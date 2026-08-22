// pty 버퍼 스크레이핑 파서(#765) — Claude Code 등 CLI 에이전트의 터미널 출력을 읽어 상태 판정.
// herdr·orca 오픈소스의 실제 감지 방식을 그대로 채택: 가장 강한 신호는 화면 본문이 아니라 OSC 터미널 타이틀.
//   - working: 타이틀 앞글자가 브라유 스피너(U+2800–28FF) 또는 사분원(U+25D0–25D3) — claude가 매 프레임 갱신.
//   - idle:    타이틀이 ✳(U+2733)로 시작.
//   - blocked/waiting: 본문에 권한/선택 프롬프트("do you want to proceed?" · "esc to cancel" · N.yes/no · tab to amend 등).
// 본문은 claude TUI가 커서 이동으로 배치 → ANSI 제거 시 공백 증발 → "공백 제거+소문자" compact에 매칭(herdr는 렌더 그리드라
//   공백 보존; 우린 raw 스트림이라 compact로 대응). 출처: herdr src/detect/manifests/{claude,codex}.toml, orca agent-title-core.ts.

// escape 시퀀스 제거(본문용). OSC는 여기서 지우되, 타이틀은 아래 lastTitle이 raw에서 따로 추출.
// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const OTHER_ESC = /\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;

function stripAnsi(s) {
  return String(s || "").replace(OSC, "").replace(CSI, "").replace(OTHER_ESC, "").replace(CTRL, "");
}

// 최근 raw tail(타이틀 추출용 — OSC 보존). 타이틀은 자주 갱신되므로 8KB면 최신 것 포함.
function recentRaw(buffer, tailBytes = 8000) {
  const raw = String(buffer || "");
  return raw.length > tailBytes ? raw.slice(-tailBytes) : raw;
}
// 본문 근사(공백 제거·소문자) — 커서이동으로 공백 증발하는 문제 대응.
function recentScreen(buffer, tailBytes = 8000) {
  return stripAnsi(recentRaw(buffer, tailBytes));
}

// 마지막 OSC 타이틀(]0; 또는 ]2;)의 페이로드. 없으면 "".
// eslint-disable-next-line no-control-regex
const TITLE_RE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
function lastTitle(rawTail) {
  const m = [...String(rawTail).matchAll(TITLE_RE)];
  return m.length ? m[m.length - 1][1] : "";
}
function firstCode(s) { return s ? s.codePointAt(0) : 0; }
// 타이틀에서 상태 글리프를 뗀 작업 설명 — Orca처럼 "지금 뭐 하는지" 서브라인용. 예: "⠐ Review notes" → "Review notes".
function titleTask(title) {
  const t = String(title).trim();
  const c = firstCode(t);
  const body = (isSpinnerGlyph(c) || isClaudeIdleGlyph(c)) ? t.slice(String.fromCodePoint(c).length).trim() : t;
  return body.slice(0, 120);
}
// 마지막 수평선(─ 3개 이상 라인) 이후 텍스트 = 현재 프롬프트/입력 박스 영역(herdr after_last_horizontal_rule).
// claude 입력창·권한 박스는 ───── 로 둘러싸여 화면 하단에 뜬다. 대화에 인용된 마커는 이 위라 제외된다.
function afterLastRule(screen) {
  const lines = String(screen).split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length >= 3 && /^[─━┄┅┈┉\s]+$/.test(t) && (t.match(/[─-╿]/g) || []).length >= 3) idx = i;
  }
  return idx >= 0 ? lines.slice(idx + 1).join("\n") : screen;
}
const isSpinnerGlyph = (c) => (c >= 0x2800 && c <= 0x28ff) || (c >= 0x25d0 && c <= 0x25d3); // 브라유/사분원
const isClaudeIdleGlyph = (c) => c === 0x2733; // ✳

// claude 본문 마커(compact = 공백제거+소문자). 출처: herdr claude.toml.
const CLAUDE_WAITING = /doyouwantto|wouldyouliketo|esctocancel|tabtoamend|ctrl\+etoexplain|waitingforpermission|❯\d+\.(yes|no)|\b\d+\.(yes|no)\b|whatshouldclaudedoinstead|interrupted·|reviewyouranswers/i;
const CLAUDE_WORKING = /esctointerrupt|[\d.]+[km]?tokens|\(\d+m?\d*s[·)]/i; // (18s·thinking / (55s·↓1.4ktokens)
const CLAUDE_CHROME = /esctointerrupt|\?forshortcuts|claudecode|bypasspermissions|manualmodeon|foragents|tokens\)/i;

// codex(보조 — 유저 주력은 claude). 출처: herdr codex.toml.
const CODEX_WAITING = /actionrequired|allowcommand\?|pressentertoconfirmoresctocancel|doyoutrustthecontentsofthisdirectory|\[y\/n\]|yes\(y\)/i;
const CODEX_WORKING = /•working\(|working\([^)]*esctointerrupt|esctointerrupt/i;
const CODEX_CHROME = /openaicodex|codex(session|resume)/i;

// 포그라운드 프로세스명 → 에이전트 id | null. "존재" 판정용(버퍼가 상태를 못 잡아도 에이전트가 떠 있음을 안다).
const PROC_MATCH = [["claude", /claude/i], ["codex", /codex/i], ["gemini", /gemini/i], ["antigravity", /antigravity/i], ["hermes", /hermes/i], ["aider", /aider/i], ["opencode", /open-?code/i], ["cursor", /cursor/i], ["copilot", /copilot/i], ["amp", /^amp$/i], ["grok", /grok/i]];
function agentFromProcess(name) {
  const p = String(name || "").trim().toLowerCase().replace(/^-+/, "");
  if (!p) return null;
  for (const [id, re] of PROC_MATCH) if (re.test(p)) return id;
  return null;
}

// 버퍼 → { agent, state } | null. 알려진 에이전트 TUI가 아니면 null(셸 등).
function parseAgentScreen(buffer) {
  const title = lastTitle(recentRaw(buffer, 16000)); // 타이틀은 넓게(입력 에코로 밀려도 확보). 전체 200k는 perf 낭비라 16KB.
  const tc = firstCode(title.trim());
  const wide = stripAnsi(recentRaw(buffer, 8000)).toLowerCase().replace(/\s+/g, "");    // 넓게 — chrome 감지(입력 에코 많아도 놓치지 않게)
  const compact = stripAnsi(recentRaw(buffer, 2500)).toLowerCase().replace(/\s+/g, ""); // 좁게 — 작업 마커(옛 tokens stale 방지)
  // ⚠️ 권한/대기 마커는 "마지막 수평선 이후"(현재 프롬프트 박스)에서만 매칭 — 대화에 인용된 "Do you want to
  //   proceed?" 같은 문구(박스 위 스크롤)를 실제 프롬프트로 오인하지 않게(herdr 영역 스코핑).
  const bottom = afterLastRule(stripAnsi(recentRaw(buffer, 4000))).toLowerCase().replace(/\s+/g, "");
  if (!wide && !title) return null;
  const task = titleTask(title); // "지금 뭐 하는지" 서브라인(타이틀의 작업 텍스트)

  // ── 신원 우선판정(#803) ──────────────────
  // 여러 CLI가 스피너 글리프·"esc to interrupt"·"? for shortcuts" 같은 공유 신호를 써서, 아래 claude 휴리스틱이
  // 다른 에이전트를 claude로 오판정한다(codex·antigravity 등). 각 에이전트 "전용 배너"를 claude보다 먼저 확정.
  // 순서 중요: antigravity 배너엔 "Gemini 3.1 Pro" 표기가 있어 gemini보다 먼저 둔다. (wide는 소문자·공백제거됨)
  const STRONG = [
    ["antigravity", /antigravity/],
    ["codex", /openaicodex|codex(session|resume)/],
    ["hermes", /hermes/],
    ["cursor", /cursoragent|cursorcli/],  // "Cursor Agent" 배너. grok보다 먼저(스크롤백 grok 오매칭 방지)
    ["grok", /grokcli|grok\d/],           // 배너/버전 동반만(맨 "grok" 단어는 대화·grep에도 흔해 sticky 오고정 방지)
    ["gemini", /geminicli|gemini\d/],     // "Gemini 2.5/3.x" 등 버전 동반. antigravity가 먼저라 그쪽 배너의 Gemini 표기엔 안 걸림
  ];
  const strongWaiting = () => title.toLowerCase().includes("action required") || CLAUDE_WAITING.test(bottom) || CODEX_WAITING.test(bottom);
  const strongWorking = () => isSpinnerGlyph(tc) || CLAUDE_WORKING.test(compact) || CODEX_WORKING.test(compact);
  for (const [id, re] of STRONG) {
    if (re.test(wide)) return { agent: id, state: strongWaiting() ? "waiting" : strongWorking() ? "working" : "idle", task };
  }

  // ── Claude ──────────────────────────────
  const claudeTitle = isSpinnerGlyph(tc) || isClaudeIdleGlyph(tc); // claude가 세팅한 상태 글리프 타이틀
  const isClaude = claudeTitle || CLAUDE_CHROME.test(wide) || CLAUDE_WORKING.test(compact) || CLAUDE_WAITING.test(bottom);
  if (isClaude) {
    if (isSpinnerGlyph(tc)) return { agent: "claude", state: "working", task };             // 스피너 타이틀 = 지금 작업 중(최우선)
    if (CLAUDE_WAITING.test(bottom)) return { agent: "claude", state: "waiting", task };     // 권한/선택/인터럽트(바닥에서만)
    if (isClaudeIdleGlyph(tc)) return { agent: "claude", state: "idle", task };              // ✳ 타이틀 = 유휴(최신)
    if (CLAUDE_WORKING.test(compact)) return { agent: "claude", state: "working", task };    // 타이틀 없는 폴백(tokens)
    return { agent: "claude", state: "idle", task };
  }

  // ── Codex(보조) ─────────────────────────
  const codexTitle = title.toLowerCase().includes("action required") || isSpinnerGlyph(tc);
  const isCodex = codexTitle || CODEX_CHROME.test(compact) || CODEX_WAITING.test(bottom) || CODEX_WORKING.test(compact);
  if (isCodex) {
    if (title.toLowerCase().includes("action required") || CODEX_WAITING.test(bottom)) return { agent: "codex", state: "waiting", task };
    if (isSpinnerGlyph(tc) || CODEX_WORKING.test(compact)) return { agent: "codex", state: "working", task };
    return { agent: "codex", state: "idle", task };
  }

  return null; // 셸 등
}

module.exports = { parseAgentScreen, agentFromProcess, stripAnsi, recentScreen, lastTitle };
