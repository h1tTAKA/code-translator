const assert = require("node:assert");
const { parseAgentScreen, stripAnsi } = require("./agent-screen.cjs");
const E = "\x1b"; // ESC

// stripAnsi가 색·커서 시퀀스 제거하나
const colored = `${E}[38;2;217;119;87mClaude${E}[0m ${E}[2m? for shortcuts${E}[0m`;
assert.ok(!stripAnsi(colored).includes(E), "ESC 남음");
assert.ok(stripAnsi(colored).includes("Claude") && stripAnsi(colored).includes("? for shortcuts"), "텍스트 유실");

// working: 스피너 + esc to interrupt
const working = `${E}[2K${E}[36m✻${E}[0m Cerebrating… (${E}[1mesc to interrupt${E}[0m · 1.2k tokens)`;
assert.deepStrictEqual(parseAgentScreen(working), { agent:"claude", state:"working" }, "working 오판: "+JSON.stringify(parseAgentScreen(working)));

// waiting: 권한 프롬프트
const waiting = `${E}[1mDo you want to proceed?${E}[0m\n ${E}[7m❯ 1. Yes${E}[0m\n   2. No, and tell Claude what to do differently`;
assert.deepStrictEqual(parseAgentScreen(waiting), { agent:"claude", state:"waiting" }, "waiting 오판: "+JSON.stringify(parseAgentScreen(waiting)));

// idle: 입력창 + shortcuts, working/waiting 마커 없음
const idle = `╭─────────╮\n│ > ${E}[0m         │\n╰─────────╯\n  ? for shortcuts`;
assert.deepStrictEqual(parseAgentScreen(idle), { agent:"claude", state:"idle" }, "idle 오판: "+JSON.stringify(parseAgentScreen(idle)));

// 셸(에이전트 아님) → null
const shell = `hong@mac nunopi % ls\nREADME.md  package.json  src`;
assert.strictEqual(parseAgentScreen(shell), null, "셸을 에이전트로 오판");

// 우선순위: 옛 working 프레임 위에 최신 waiting → waiting(뒤쪽=최신). tail 3500 안이라 둘 다 있지만 waiting 우선.
const mixed = working + "\n".repeat(3) + waiting;
assert.strictEqual(parseAgentScreen(mixed).state, "waiting", "우선순위 실패");

console.log("PASS — 6 assertions");
