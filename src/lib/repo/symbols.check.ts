// symbols.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/symbols.check.ts
import assert from "node:assert";
import { extractSymbols } from "./symbols.ts";

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

console.log("symbols.check OK");
