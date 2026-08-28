// symbols.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/symbols.check.ts
import assert from "node:assert";
import { extractSymbols, resolveCalls } from "./symbols.ts";

// TS — 함수 선언·arrow const·클래스·메서드·타입.
const ts = `export function foo() {}
export const Bar = () => {};
class C { m() {} get g() { return 1; } }
type T = string;
`;
const r = await extractSymbols(ts, "a.ts");
const names = new Set(r.symbols.map((s) => s.name));
assert.ok(names.has("foo"), "함수 선언 foo");
assert.ok(names.has("Bar"), "arrow const Bar (함수로)");
assert.ok(names.has("C"), "클래스 C");
assert.ok(names.has("m"), "메서드 m");
assert.ok(names.has("T"), "타입 T");
assert.strictEqual(r.symbols.find((s) => s.name === "Bar")!.kind, "function", "arrow const = function kind");
assert.strictEqual(r.symbols.find((s) => s.name === "C")!.kind, "class", "C = class kind");
assert.strictEqual(r.symbols.find((s) => s.name === "T")!.kind, "type", "T = type kind");

// contains 엣지: 모두 file→symbol, source=파일.
assert.strictEqual(r.contains.length, r.symbols.length, "contains 수 = 심볼 수");
assert.ok(r.contains.every((e) => e.source === "a.ts" && e.relation === "contains"), "contains: 파일→심볼");
// 노드 id = 파일#이름.
assert.ok(r.nodes.every((n) => n.id.startsWith("a.ts#") && n.file === "a.ts"), "노드 id·file");

// 동명 심볼 유일화 — 두 클래스에 같은 메서드명.
const dup = await extractSymbols(`class A { run() {} }\nclass B { run() {} }`, "d.ts");
const runIds = dup.symbols.filter((s) => s.name === "run").map((s) => s.id);
assert.strictEqual(runIds.length, 2, "run 2개");
assert.strictEqual(new Set(runIds).size, 2, "run id 유일(중복 접미)");

// Python — def·class.
const py = await extractSymbols(`def foo():\n  pass\nclass C:\n  def m(self):\n    pass`, "a.py");
const pynames = new Set(py.symbols.map((s) => s.name));
assert.ok(pynames.has("foo") && pynames.has("C") && pynames.has("m"), "python def/class/method");

// Go — func·method·type.
const go = await extractSymbols(`package m\nfunc Foo() {}\ntype S struct{}\nfunc (s S) M() {}`, "a.go");
const gonames = new Set(go.symbols.map((s) => s.name));
assert.ok(gonames.has("Foo") && gonames.has("M") && gonames.has("S"), `go func/method/type (${[...gonames]})`);

// 미지원 언어 → 빈 결과.
const none = await extractSymbols("hello", "a.txt");
assert.strictEqual(none.symbols.length, 0, "미지원 언어 심볼 0");

// --- 호출(calls) ---
// in-file: foo가 bar 호출, C(arrow)가 foo 호출.
const callSrc = `function foo(){ return bar(); }
function bar(){ return 1; }
const C = () => { foo(); };`;
const cr = await extractSymbols(callSrc, "c.ts");
const inFile = resolveCalls(cr.calls, cr.symbols, new Map());
const hasEdge = (s: string, t: string) => inFile.some((e) => e.source === s && e.target === t && e.relation === "calls");
assert.ok(hasEdge("c.ts#foo", "c.ts#bar"), "foo→bar calls");
assert.ok(hasEdge("c.ts#C", "c.ts#foo"), "C→foo calls");
assert.ok(!inFile.some((e) => e.source === e.target), "자기호출 없음");

// cross-file: a가 util의 helper 호출 → import 테이블로 해석.
const aSrc = `import { helper } from "./util";\nfunction go(){ return helper(); }`;
const a = await extractSymbols(aSrc, "a.ts");
const util = await extractSymbols(`export function helper(){ return 2; }`, "util.ts");
const crossEdges = resolveCalls(a.calls, a.symbols, new Map([["util.ts", util.symbols]]));
assert.ok(crossEdges.some((e) => e.source === "a.ts#go" && e.target === "util.ts#helper" && e.relation === "calls"), "cross-file go→util.helper");

// 미해결 호출(어디에도 없는 이름) → 엣지 없음.
const un = await extractSymbols(`function q(){ nonexistentFn(); }`, "u.ts");
assert.strictEqual(resolveCalls(un.calls, un.symbols, new Map()).length, 0, "미해결 호출 엣지 0");

// 멤버 호출 노이즈 차단 — 로컬에 add 함수 있어도 arr.add()는 연결 안 됨(this.add는 연결).
const mem = await extractSymbols(`function add(){}\nfunction useArr(){ const arr=[]; arr.add(1); }\nclass K { add(){} run(){ this.add(); } }`, "m.ts");
const memEdges = resolveCalls(mem.calls, mem.symbols, new Map());
assert.ok(!memEdges.some((e) => e.source === "m.ts#useArr"), "arr.add() → 로컬 add 오연결 안 함");
// this.add() from run → 연결됨(dedup 접미 허용). #843 scope-aware: 모듈레벨 add가 아니라 K 클래스의 add로.
const runEdge = memEdges.find((e) => e.source === "m.ts#run" && /#add(:\d+)?$/.test(e.target));
assert.ok(runEdge, "this.add() → 연결됨");
const kAdd = mem.symbols.find((s) => s.name === "add" && s.owner === "K");
assert.strictEqual(runEdge!.target, kAdd!.id, "this.add()는 모듈 add가 아니라 소속 클래스 K의 add로 해석(scope-aware)");

// --- 관계 확장(#843): extends/implements + signature ---
const her = await extractSymbols(`class A extends B implements C { m(a: number): string { return ""; } }`, "h.ts");
assert.ok(her.heritage.some((h) => h.baseName === "B" && h.relation === "extends"), "extends B 추출");
assert.ok(her.heritage.some((h) => h.baseName === "C" && h.relation === "implements"), "implements C 추출");
assert.ok(her.symbols.find((s) => s.name === "m")?.signature?.includes("a: number"), "메서드 signature 추출");
// Python bases → extends
const pyc = await extractSymbols(`class Foo(Bar, Baz):\n  def m(self):\n    return 1`, "p.py");
assert.ok(pyc.heritage.filter((h) => h.relation === "extends").length === 2, "Python bases 2개 extends");

// --- JSX 컴포넌트 사용 = calls(#857) ---
// <Logo/> 사용을 호출로. 대문자 컴포넌트만, html 소문자 태그(div)는 제외.
const jsx = await extractSymbols(`import { Logo } from "./logo";\nfunction App(){ return <div><Logo /></div>; }`, "app.tsx");
const jsxEdges = resolveCalls(jsx.calls, jsx.symbols, new Map([["logo.tsx", (await extractSymbols(`export function Logo(){ return null; }`, "logo.tsx")).symbols]]));
assert.ok(jsxEdges.some((e) => e.source === "app.tsx#App" && e.target === "logo.tsx#Logo" && e.relation === "calls"), "JSX <Logo/> → 컴포넌트 호출 엣지");
assert.ok(jsx.calls.some((c) => c.calleeName === "Logo"), "jsx_element name 필드 추출됨");
assert.ok(!jsx.calls.some((c) => c.calleeName === "div"), "html 소문자 태그(div)는 호출 아님");

console.log("symbols.check OK");
