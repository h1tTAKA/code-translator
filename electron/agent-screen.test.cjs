const assert = require("node:assert");
const { parseAgentScreen, stripAnsi, lastTitle } = require("./agent-screen.cjs");
const E = "\x1b"; // ESC
const title = (t) => `${E}]0;${t}\x07`; // OSC 타이틀 세팅
const braille = "⠐"; // ⠐ 브라유 스피너 프레임
const idleGlyph = "✳"; // ✳

// stripAnsi: 색·OSC·제어 제거, 텍스트 보존
const colored = `${E}[38;2;217;119;87mClaude${E}[0m ${title("x")}? for shortcuts`;
assert.ok(!stripAnsi(colored).includes(E), "ESC 남음");
assert.ok(stripAnsi(colored).includes("Claude"), "텍스트 유실");

// lastTitle: 마지막 타이틀 페이로드
assert.strictEqual(lastTitle(title("aaa") + "junk" + title("bbb")), "bbb", "lastTitle 실패");

// working: 브라유 스피너 타이틀 (본문에 tokens 없어도 — thinking with high effort 케이스)
const working = title(`${braille} Doing task`) + `${E}[36m✽${E}[0m Unfurling… (18s · thinking with high effort)`;
assert.deepStrictEqual(parseAgentScreen(working), { agent: "claude", state: "working" }, "working 오판: " + JSON.stringify(parseAgentScreen(working)));

// working: 타이틀 없어도 본문 tokens 라인
const working2 = `✽ Improvising… (55s · ${E}[2m↓ 1.4k tokens${E}[0m)`;
assert.deepStrictEqual(parseAgentScreen(working2), { agent: "claude", state: "working" }, "working2 오판: " + JSON.stringify(parseAgentScreen(working2)));

// waiting: 권한 프롬프트(본문). 커서이동으로 공백 증발한 실측 형태 흉내(붙은 텍스트).
const waiting = title(`${idleGlyph} Task`) + `Doyouwanttoproceed?❯1.Yes2.NoEsctocancel·Tabtoamend·ctrl+etoexplain`;
assert.strictEqual(parseAgentScreen(waiting).state, "waiting", "waiting 오판: " + JSON.stringify(parseAgentScreen(waiting)));

// idle: ✳ 타이틀 + 프롬프트, working/waiting 마커 없음
const idle = title(`${idleGlyph} Review notes`) + `╭───╮\n│ > │\n╰───╯  ? for shortcuts`;
assert.deepStrictEqual(parseAgentScreen(idle), { agent: "claude", state: "idle" }, "idle 오판: " + JSON.stringify(parseAgentScreen(idle)));

// 셸(타이틀·마커 없음) → null
const shell = `hong@mac nunopi % ls\nREADME.md  package.json  src`;
assert.strictEqual(parseAgentScreen(shell), null, "셸을 에이전트로 오판");

// 우선순위: 스피너 타이틀 = 지금 작업 중(프레임마다 갱신되는 최신 신호) → 본문에 남은 옛 권한 텍스트보다 우선 = working.
// (실제 권한 대기 땐 타이틀이 스피너가 아니라 ✳/비스피너라, 위 waiting 테스트가 그 케이스를 검증.)
const spinnerOverStale = title(`${braille} x`) + `Doyouwanttoproceed?❯1.Yes2.No Esctocancel`;
assert.strictEqual(parseAgentScreen(spinnerOverStale).state, "working", "스피너 우선 실패");

console.log("PASS — all assertions");
