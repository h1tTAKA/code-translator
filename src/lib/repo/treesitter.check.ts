// treesitter.ts self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/treesitter.check.ts
import assert from "node:assert";
import type Parser from "web-tree-sitter";
import { parseFile, grammarForFile } from "./treesitter.ts";

// grammar 매핑.
assert.strictEqual(grammarForFile("a.ts"), "typescript", ".ts → typescript");
assert.strictEqual(grammarForFile("a.tsx"), "tsx", ".tsx → tsx");
assert.strictEqual(grammarForFile("a.py"), "python", ".py → python");
assert.strictEqual(grammarForFile("a.txt"), null, "미지원 → null");

// TS 파싱 — 함수 선언이 트리에 잡히나.
const src = `function cardProps(x: number) { return x + 1; }\nclass Foo { bar() {} }\n`;
const r = await parseFile(src, "x.ts");
assert.ok(r, "TS 파싱 결과 있음");
const root = r!.tree.rootNode;
assert.ok(root.childCount >= 2, `최상위 노드 2+ (${root.childCount})`);

// function_declaration·class_declaration 타입이 트리에 존재.
const types = new Set<string>();
const walk = (n: Parser.SyntaxNode) => {
  types.add(n.type);
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c); }
};
walk(root);
assert.ok(types.has("function_declaration"), "function_declaration 노드 존재");
assert.ok(types.has("class_declaration"), "class_declaration 노드 존재");
assert.ok(types.has("method_definition"), "method_definition 노드 존재");

// 미지원 언어 → null.
const none = await parseFile("hello", "a.txt");
assert.strictEqual(none, null, "미지원 언어 파싱 null");

console.log("treesitter.check OK");
