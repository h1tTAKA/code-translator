// mcpActivity 점검 — node --experimental-strip-types src/lib/mcpActivity.check.ts
import assert from "node:assert";
import { extractConcept, emitToolCall, subscribe, recent } from "./mcpActivity.ts";

// 개념 추출
assert.deepEqual(extractConcept("katchup_find_code", { name: "postMessage" }), { kind: "symbol", target: "postMessage" });
assert.deepEqual(extractConcept("katchup_trace_calls", { symbol: "getDb" }), { kind: "symbol", target: "getDb" });
assert.deepEqual(extractConcept("katchup_file_api", { file: "app/x.ts" }), { kind: "file", target: "app/x.ts" });
assert.deepEqual(extractConcept("katchup_search", { query: "멘션 흐름" }), { kind: "query", target: "멘션 흐름" });
assert.equal(extractConcept("katchup_repo_map", {}).kind, "repo");
assert.equal(extractConcept("katchup_check_freshness", {}), null, "freshness는 개념 아님");
assert.equal(extractConcept("katchup_find_code", {}), null, "빈 인자 스킵");

// emit → subscribe fan-out + recent(root 필터)
const got: string[] = [];
const unsub = subscribe((e) => got.push(`${e.kind}:${e.target}`));
emitToolCall("/repo/A", "katchup_find_code", { name: "foo" }, false, 1);
emitToolCall("/repo/B", "katchup_file_api", { file: "b.ts" }, false, 2);
emitToolCall("/repo/A", "katchup_check_freshness", {}, false, 3); // 스킵(개념 아님)
unsub();
emitToolCall("/repo/A", "katchup_find_code", { name: "after-unsub" }, false, 4); // 구독 해제 후 → 안 받음

assert.deepEqual(got, ["symbol:foo", "file:b.ts"], "fan-out은 개념 있는 것만, 해제 후 미수신");
const rA = recent("/repo/A", 10).map((e) => e.target);
assert.ok(rA.includes("foo") && rA.includes("after-unsub") && !rA.includes("b.ts"), "recent는 root A만");

console.log("mcpActivity.check OK");
