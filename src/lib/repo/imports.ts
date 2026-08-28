// import 지정자 → 레포 내 파일 해석(#853) — 상대(./ ../) + tsconfig paths 별칭(@/* 등) + baseUrl bare.
// (상대만 해석하면 Next 앱의 @/ 별칭 import가 전부 엣지 0 → 그래프 반쪽. Graft도 TS는 상대만이라 여기서 이김.)
// 경량 모듈(node:path/fs만) — 단위테스트·재사용 쉽게 graph.ts서 분리.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

const CANDIDATE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rb", ".rs", ".php", ".cs", ".c", ".cc", ".cpp", ".swift"];
const INDEX_BASES = ["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"];

// tsconfig paths 별칭 규칙. pattern "@/*" → targets ["src/*","*"](baseUrl 기준 root-상대 접두).
export interface AliasConf { baseDir: string; rules: Array<{ prefix: string; suffix: string; wildcard: boolean; pattern: string; targets: string[] }> }

// 후보 경로(root-상대)를 확장자/인덱스로 fileSet서 찾기.
function tryResolve(base: string, fileSet: Set<string>): string | null {
  const b = posix.normalize(base).replace(/^\.?\//, "").replace(/^\/+/, "");
  for (const ext of CANDIDATE_EXTS) { const c = b + ext; if (fileSet.has(c)) return c; }
  for (const idx of INDEX_BASES) { const c = posix.join(b, idx); if (fileSet.has(c)) return c; }
  return null;
}

export function resolveImport(spec: string, fromFile: string, fileSet: Set<string>, alias?: AliasConf): string | null {
  if (spec.startsWith(".")) { // 상대
    return tryResolve(posix.join(posix.dirname(fromFile), spec), fileSet);
  }
  if (alias) {
    for (const r of alias.rules) { // tsconfig paths 별칭
      if (r.wildcard) {
        if (spec.length >= r.prefix.length + r.suffix.length && spec.startsWith(r.prefix) && spec.endsWith(r.suffix)) {
          const rest = spec.slice(r.prefix.length, spec.length - r.suffix.length);
          for (const t of r.targets) { const hit = tryResolve(posix.join(alias.baseDir, t.replace("*", rest)), fileSet); if (hit) return hit; }
        }
      } else if (spec === r.pattern) {
        for (const t of r.targets) { const hit = tryResolve(posix.join(alias.baseDir, t), fileSet); if (hit) return hit; }
      }
    }
    // baseUrl bare import(별칭 미매칭 시)
    const hit = tryResolve(posix.join(alias.baseDir, spec), fileSet); if (hit) return hit;
  }
  return null; // 패키지/외부
}

// JSONC(주석·후행쉼표) 관대 파싱.
function parseJsonc<T = unknown>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* strip 후 재시도 */ }
  try {
    const stripped = text.replace(/\/\/[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as T;
  } catch { return null; }
}

// tsconfig/jsconfig의 baseUrl + paths → AliasConf(root-상대). extends는 미추적(루트 설정만, 대부분 충분).
export function loadAliases(root: string): AliasConf | null {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    let text: string;
    try { text = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const cfg = parseJsonc<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>(text);
    const co = cfg?.compilerOptions;
    if (!co) continue;
    const baseDir = posix.normalize(co.baseUrl ?? ".").replace(/^\.\/?$/, "").replace(/^\.\//, "");
    const rules: AliasConf["rules"] = [];
    for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
      const star = pattern.indexOf("*");
      const wildcard = star >= 0 && star === pattern.lastIndexOf("*"); // 정확히 1개만 와일드카드 취급(다중 *는 exact로, 오해석 방지)
      const prefix = wildcard ? pattern.slice(0, star) : "";
      const suffix = wildcard ? pattern.slice(star + 1) : "";
      rules.push({ prefix, suffix, wildcard, pattern, targets: (targets ?? []).map((t) => t.replace(/^\.\//, "")) });
    }
    if (rules.length || co.baseUrl) return { baseDir, rules };
  }
  return null;
}
