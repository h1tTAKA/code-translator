const assert = require("node:assert");
const { parseAgentScreen, stripAnsi, lastTitle } = require("./agent-screen.cjs");
const E = "\x1b"; // ESC
const title = (t) => `${E}]0;${t}\x07`; // OSC 타이틀 세팅
const braille = "⠐"; // ⠐ 브라유 스피너 프레임
const idleGlyph = "✳"; // ✳
// agent/state만 비교(task는 케이스마다 다름)
const st = (buf) => { const r = parseAgentScreen(buf); return r ? `${r.agent}/${r.state}` : null; };

// stripAnsi: 색·OSC·제어 제거, 텍스트 보존
const colored = `${E}[38;2;217;119;87mClaude${E}[0m ${title("x")}? for shortcuts`;
assert.ok(!stripAnsi(colored).includes(E), "ESC 남음");
assert.ok(stripAnsi(colored).includes("Claude"), "텍스트 유실");

// lastTitle: 마지막 타이틀 페이로드
assert.strictEqual(lastTitle(title("aaa") + "junk" + title("bbb")), "bbb", "lastTitle 실패");

// task 추출: 타이틀 글리프 뗀 작업 텍스트
assert.strictEqual(parseAgentScreen(title(`${idleGlyph} Review notes`) + "? for shortcuts").task, "Review notes", "task 추출 실패");

// working: 브라유 스피너 타이틀 (본문에 tokens 없어도 — thinking with high effort 케이스)
const working = title(`${braille} Doing task`) + `${E}[36m✽${E}[0m Unfurling… (18s · thinking with high effort)`;
assert.strictEqual(st(working), "claude/working", "working 오판: " + st(working));

// working: 타이틀 없어도 본문 tokens 라인
const working2 = `✽ Improvising… (55s · ${E}[2m↓ 1.4k tokens${E}[0m)`;
assert.strictEqual(st(working2), "claude/working", "working2 오판: " + st(working2));

// waiting: 권한 프롬프트(마지막 수평선 이후). 커서이동 공백 증발 형태.
const waiting = title(`${idleGlyph} Task`) + `─────\nDoyouwanttoproceed?❯1.Yes2.NoEsctocancel·Tabtoamend·ctrl+etoexplain`;
assert.strictEqual(st(waiting), "claude/waiting", "waiting 오판: " + st(waiting));

// idle: ✳ 타이틀 + 프롬프트, working/waiting 마커 없음
const idle = title(`${idleGlyph} Review notes`) + `╭───╮\n│ > │\n╰───╯  ? for shortcuts`;
assert.strictEqual(st(idle), "claude/idle", "idle 오판: " + st(idle));

// idle: 대화에 권한 문구 인용(스크롤 위) + 바닥은 입력창 → idle(영역 스코핑).
const quotedNotLive = title(`${idleGlyph} Task`) +
  `I explained: "Do you want to proceed?" and "esc to cancel" and "1. Yes 2. No".\n`.repeat(20) +
  `✻ churned for 3m\n─────\n❯ \n⏸ manual mode on · ← for agents · ctrl+v to paste`;
assert.strictEqual(st(quotedNotLive), "claude/idle", "인용문 오판: " + st(quotedNotLive));

// 셸(타이틀·마커 없음) → null
const shell = `hong@mac nunopi % ls\nREADME.md  package.json  src`;
assert.strictEqual(st(shell), null, "셸을 에이전트로 오판");

// 우선순위: 스피너 타이틀 = 현재 작업 중(최신) → 본문 옛 권한보다 우선 = working.
const spinnerOverStale = title(`${braille} x`) + `─────\nDoyouwanttoproceed?❯1.Yes2.No Esctocancel`;
assert.strictEqual(st(spinnerOverStale), "claude/working", "스피너 우선 실패");

console.log("PASS — all assertions");
