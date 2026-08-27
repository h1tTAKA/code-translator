// flowConnect 자체 점검 — node --experimental-strip-types src/lib/repo/flowConnect.check.ts
import assert from "node:assert";
import { connectionsAmong } from "./flowConnect.ts";
import type { RepoGraph } from "./types.ts";

const g: RepoGraph = {
  nodes: [],
  edges: [
    { source: "a.ts", target: "b.ts", relation: "imports" },
    { source: "a.ts#foo", target: "b.ts#bar", relation: "calls" }, // a→b 두 근거
    { source: "b.ts", target: "c.ts", relation: "imports" },
    { source: "a.ts#foo", target: "a.ts#baz", relation: "calls" }, // 자기파일 제외
    { source: "a.ts", target: "z.ts", relation: "imports" },       // z 미포함 제외
    { source: "a.ts#foo", target: "b.ts#bar", relation: "contains" }, // contains 제외
  ],
  communities: [],
  stats: { files: 0, symbols: 0, edges: 0 },
} as unknown as RepoGraph;

const conns = connectionsAmong(g, ["a.ts", "b.ts", "c.ts"]);
const key = (from: string, to: string) => conns.find((c) => c.from === from && c.to === to);

assert.equal(conns.length, 2, `a→b, b→c 두 연결만 (got ${conns.length})`);
const ab = key("a.ts", "b.ts");
assert.ok(ab, "a→b 있어야");
assert.deepEqual([...ab!.via].sort(), ["calls", "imports"], "a→b 근거 두 관계 병합");
assert.ok(key("b.ts", "c.ts"), "b→c 있어야");
assert.ok(!key("a.ts", "a.ts"), "자기파일 없어야");
assert.ok(!key("a.ts", "z.ts"), "미포함 파일 없어야");

console.log("flowConnect.check OK");
