// tree-sitter 로더 — 서버(Node) 전용. WASM grammar를 런타임 로드해 소스 → 구문트리(AST).
// web-tree-sitter@0.20(런타임) + tree-sitter-wasms(prebuilt grammar, tree-sitter 0.20 ABI). 심볼 추출(symbols.ts)의 파싱 계층.
// 초기화·언어 로드는 1회만(캐시). native build 없음(전부 WASM).
// 버전 주의: grammar가 tree-sitter-cli 0.20으로 빌드돼 web-tree-sitter도 0.20이어야 ABI 맞음(신버전은 로드 실패).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import Parser from "web-tree-sitter";

// external 패키지라 import.meta.url이 번들러 가상 경로가 됨 → 실제 node_modules 기준(cwd)으로 resolve.
const require = createRequire(join(process.cwd(), "package.json"));

// 패키지 위치 기준으로 .wasm 경로를 런타임에 조립(번들러가 .wasm을 정적 분석·번들하지 않게 —
// require.resolve로 직접 .wasm을 가리키면 Turbopack이 grammar wasm을 파싱하려다 깨진다).
const runtimeWasmPath = () => join(dirname(require.resolve("web-tree-sitter/package.json")), "tree-sitter.wasm");
const grammarWasmPath = (grammar: string) => join(dirname(require.resolve("tree-sitter-wasms/package.json")), "out", `tree-sitter-${grammar}.wasm`);

// 확장자 → tree-sitter-wasms grammar 이름(out/tree-sitter-{이름}.wasm).
// LANGS(langs.ts)와 짝 — import 그래프는 정규식/컴파일러, 심볼은 tree-sitter.
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "javascript",
  ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".cs": "c_sharp", ".rb": "ruby", ".rs": "rust", ".php": "php",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp",
  ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp", ".swift": "swift",
};

function extOf(file: string): string {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i).toLowerCase();
}

// 파일 → grammar 이름(심볼 추출 지원 언어면), 아니면 null.
export function grammarForFile(file: string): string | null {
  return EXT_TO_GRAMMAR[extOf(file)] ?? null;
}

let initPromise: Promise<void> | null = null;
const langCache = new Map<string, Parser.Language>();

// WASM 런타임 1회 초기화. locateFile로 tree-sitter.wasm 실제 경로 지정(Node).
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const runtimeWasm = runtimeWasmPath();
    initPromise = Parser.init({ locateFile: () => runtimeWasm });
  }
  await initPromise;
}

// grammar 이름 → Language(캐시). wasm 경로를 로더에 전달(Node서 파일 읽음).
async function loadLanguage(grammar: string): Promise<Parser.Language> {
  const cached = langCache.get(grammar);
  if (cached) return cached;
  const wasmPath = grammarWasmPath(grammar);
  const lang = await Parser.Language.load(wasmPath);
  langCache.set(grammar, lang);
  return lang;
}

// 소스 → 구문트리. 미지원 언어면 null. (파서는 매 호출 새로 — 언어 캐시가 무거운 부분.)
export async function parseFile(text: string, file: string): Promise<{ tree: Parser.Tree; grammar: string } | null> {
  const grammar = grammarForFile(file);
  if (!grammar) return null;
  await ensureInit();
  const lang = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(text);
  parser.delete(); // WASM 힙 객체 — GC 안 됨. tree는 파서와 독립이라 여기서 파서 해제(호출자가 tree.delete()).
  return { tree, grammar };
}
