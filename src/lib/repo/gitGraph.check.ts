// gitGraph self-check — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/gitGraph.check.ts
import assert from "node:assert";
import { parseGitLog, assignLanes, githubLogin } from "./gitGraph.ts";

// githubLogin: noreply 이메일 → 로그인, 아니면 null.
assert.strictEqual(githubLogin("12345+hong@users.noreply.github.com"), "hong", "id+login noreply");
assert.strictEqual(githubLogin("hong@users.noreply.github.com"), "hong", "login noreply");
assert.strictEqual(githubLogin("me@gmail.com"), null, "일반 이메일 → null");
assert.strictEqual(githubLogin(""), null, "빈 이메일 → null");

// 파싱: 한 줄 형식 %H|%P|%an|%ae|%at|%D|%s.
const log = [
  "c3|c2|Kim|1+kim@users.noreply.github.com|1700000003|HEAD -> main, origin/main|feat: 세 번째",
  "c2|c1|Kim|kim@corp.com|1700000002||fix: 두 번째",
  "c1||Kim|kim@corp.com|1700000001|tag: v1|init",
].join("\n");
const commits = parseGitLog(log);
assert.strictEqual(commits.length, 3, "3 커밋 파싱");
assert.deepStrictEqual(commits[0].parents, ["c2"], "부모 파싱");
assert.strictEqual(commits[0].email, "1+kim@users.noreply.github.com", "email 파싱");
assert.strictEqual(commits[0].ts, 1700000003, "ts 파싱(email 다음 자리)");
assert.strictEqual(githubLogin(commits[0].email), "kim", "커밋 email→닉");
assert.deepStrictEqual(commits[0].refs, ["main", "origin/main"], "refs: HEAD-> 제거·분해");
assert.strictEqual(commits[0].isHead, true, "c3 = HEAD");
assert.strictEqual(commits[1].isHead, false, "c2 ≠ HEAD");
assert.deepStrictEqual(commits[2].refs, ["v1"], "tag: 제거");
assert.deepStrictEqual(commits[1].parents, ["c1"], "c2 부모 c1");
assert.strictEqual(commits[2].parents.length, 0, "루트 부모 없음");
assert.strictEqual(commits[0].subject, "feat: 세 번째", "subject");

// detached HEAD("HEAD" 단독) 감지.
const det = parseGitLog("x|y|K|k@corp.com|9|HEAD|wip")[0];
assert.strictEqual(det.isHead, true, "detached HEAD 감지");

// origin/HEAD·bare HEAD 잡음 제거(HEAD는 현재 브랜치 배지로만).
const noise = parseGitLog("z|y|K|k@x|9|HEAD -> main, origin/main, origin/HEAD, tag: v2|x")[0];
assert.deepStrictEqual(noise.refs, ["main", "origin/main", "v2"], "origin/HEAD·HEAD 제거");
assert.strictEqual(noise.isHead, true, "HEAD -> 여도 isHead");

// 직선 히스토리 → 전부 레인 0.
const lin = assignLanes(commits);
assert.ok(lin.rows.every((r) => r.lane === 0), "직선=레인0");
assert.strictEqual(lin.laneCount, 1, "직선 레인 1개");

// 분기+머지: m(부모 a,b) → a(부모 base) → b(부모 base) → base.
const merged = parseGitLog([
  "m|a b|K|k@x|4||merge",
  "a|base|K|k@x|3||branchA",
  "b|base|K|k@x|2||branchB",
  "base||K|k@x|1||base",
].join("\n"));
const g = assignLanes(merged);
// m은 부모 2개 → a,b가 서로 다른 레인으로 갈라짐 → 레인 2개 이상.
assert.ok(g.laneCount >= 2, "머지=레인 2개 이상");
assert.strictEqual(g.rows[0].commit.hash, "m", "m 먼저");
assert.strictEqual(g.rows[0].lane, 0, "m 레인0");
// a,b는 서로 다른 레인.
const aRow = g.rows.find((r) => r.commit.hash === "a")!;
const bRow = g.rows.find((r) => r.commit.hash === "b")!;
assert.notStrictEqual(aRow.lane, bRow.lane, "a·b 다른 레인");
// base는 a,b가 수렴 — 모든 커밋 dot 레인 배정됨(음수 없음).
assert.ok(g.rows.every((r) => r.lane >= 0), "모든 dot 레인 >=0");

// 결정적: 두 번 동일.
assert.deepStrictEqual(assignLanes(merged), g, "레인 배정 결정적");

console.log("gitGraph.check OK");
