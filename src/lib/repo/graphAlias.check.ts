// resolveImport 별칭 해석 점검 — node --experimental-strip-types src/lib/repo/graphAlias.check.ts
import assert from "node:assert";
import { resolveImport, type AliasConf } from "./imports.ts";

const files = new Set(["src/lib/slack.ts", "lib/format.ts", "app/api/events/route.ts", "src/util/index.ts"]);

// nunopi식: @/* → ["src/*","*"]
const alias: AliasConf = { baseDir: "", rules: [{ prefix: "@/", suffix: "", wildcard: true, pattern: "@/*", targets: ["src/*", "*"] }] };

// @/lib/slack → src/lib/slack.ts (첫 타깃 src/* 매칭)
assert.equal(resolveImport("@/lib/slack", "app/api/events/route.ts", files, alias), "src/lib/slack.ts", "@/ → src/*");
// @/lib/format → lib/format.ts (src/lib/format 없음 → 둘째 타깃 *)
assert.equal(resolveImport("@/lib/format", "app/x.ts", files, alias), "lib/format.ts", "@/ → * 폴백");
// @/util → src/util/index.ts (인덱스 해석)
assert.equal(resolveImport("@/util", "app/x.ts", files, alias), "src/util/index.ts", "@/ → index");
// 상대 여전히 동작
assert.equal(resolveImport("./slack", "src/lib/x.ts", files, alias), "src/lib/slack.ts", "상대 유지");
// 외부 패키지 → null
assert.equal(resolveImport("@vercel/functions", "app/x.ts", files, alias), null, "패키지 null");
// 별칭 없으면 상대만
assert.equal(resolveImport("@/lib/slack", "app/x.ts", files, undefined), null, "별칭 conf 없으면 null");

console.log("graphAlias.check OK");
