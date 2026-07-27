// 심볼 추출 — 서버(Node) 전용. tree-sitter AST에서 함수/클래스/메서드/타입 심볼 노드 + contains 엣지.
// 파일 드릴다운(자식D)의 데이터. 호출(calls) 엣지는 다음 커밋. 범용: grammar별 심볼 노드타입 세트 + "name" 필드.
// ponytail: 언어별 완벽 규칙 대신 공통 선언노드 집합 + childForFieldName("name") 휴리스틱 —
// tree-sitter grammar 대부분 선언 노드에 name 필드 노출. 특이 케이스(TS arrow-const)만 특례.
import type Parser from "web-tree-sitter";
import { parseFile } from "./treesitter.ts";
import type { RepoNode, RepoEdge, RepoNodeKind } from "./types";

// 심볼로 볼 노드타입 → kind. (probe로 확인: ts/py/go/rust/java + 표준 grammar 명칭.)
const SYMBOL_KIND: Record<string, RepoNodeKind> = {
  // 함수/메서드
  function_declaration: "function", function_definition: "function", function_item: "function",
  method_definition: "function", method_declaration: "function", func_literal: "function",
  constructor_declaration: "function", method: "function", singleton_method: "function",
  // 클래스/구조/트레잇/인터페이스/모듈/enum
  class_declaration: "class", class_definition: "class", class_specifier: "class",
  struct_item: "class", struct_specifier: "class", struct_declaration: "class",
  impl_item: "class", trait_item: "class", interface_declaration: "class",
  enum_declaration: "class", enum_item: "class", object_declaration: "class",
  protocol_declaration: "class", module: "class",
  // 타입 별칭
  type_alias_declaration: "type", type_spec: "type",
};

export interface SymbolInfo {
  id: string;          // "파일#이름" (중복 시 ":n" 접미)
  name: string;
  kind: RepoNodeKind;
  startIndex: number;  // 바이트 범위(호출 스코프 판정·소스 조각용)
  endIndex: number;
  startRow: number;    // 표시용(1-based 아님, tree-sitter 0-based)
}

// 원시 호출 — 아직 대상 미해결. callerId=이 호출을 감싼 심볼(없으면 null=모듈레벨, 버림).
export interface RawCall { callerId: string; calleeName: string }

// 노드의 심볼명 — "name" 필드 우선, 없으면 첫 식별자류 자식.
function symbolName(node: Parser.SyntaxNode): string | null {
  const named = node.childForFieldName("name");
  if (named?.text) return named.text;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && /identifier|type_identifier|constant|field_identifier|name/.test(c.type)) return c.text;
  }
  return null;
}

// 호출식의 대상 이름 — identifier면 그대로, 멤버/셀렉터면 마지막 조각(obj.method→method).
function calleeNameOf(fn: Parser.SyntaxNode): string | null {
  if (fn.type === "identifier") return fn.text;
  const prop = fn.childForFieldName("property") ?? fn.childForFieldName("field") ?? fn.childForFieldName("name");
  if (prop?.text) return prop.text;
  const seg = fn.text.split(/[.:]/).pop()?.trim();
  return seg && /^[A-Za-z_]\w*$/.test(seg) ? seg : null; // 식별자꼴만(체이닝·괄호 노이즈 배제)
}

// 소스+파일 → 심볼 목록 + 노드 + contains 엣지(file→symbol) + 원시 호출. 미지원 언어면 빈 결과.
export async function extractSymbols(text: string, file: string): Promise<{ symbols: SymbolInfo[]; nodes: RepoNode[]; contains: RepoEdge[]; calls: RawCall[] }> {
  const parsed = await parseFile(text, file);
  if (!parsed) return { symbols: [], nodes: [], contains: [], calls: [] };

  const symbols: SymbolInfo[] = [];
  const usedIds = new Set<string>();
  const add = (name: string, kind: RepoNodeKind, node: Parser.SyntaxNode) => {
    let id = `${file}#${name}`;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${id}:${n}`)) n++; id = `${id}:${n}`; } // 동명 심볼 유일화
    usedIds.add(id);
    symbols.push({ id, name, kind, startIndex: node.startIndex, endIndex: node.endIndex, startRow: node.startPosition.row });
  };

  // 전체 순회 — 심볼 노드면 수집(중첩 메서드·클로저 포함). ponytail: 깊이 제한 없음, 초대형 파일만 주의.
  const walk = (node: Parser.SyntaxNode) => {
    const kind = SYMBOL_KIND[node.type];
    if (kind) {
      const name = symbolName(node);
      if (name) add(name, kind, node);
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      // TS/JS: `const X = () => {}` / `const X = function(){}` → 함수 심볼(React 컴포넌트·핸들러 다수).
      for (let i = 0; i < node.namedChildCount; i++) {
        const d = node.namedChild(i);
        if (d?.type !== "variable_declarator") continue;
        const val = d.childForFieldName("value");
        const nm = d.childForFieldName("name");
        if (nm?.text && val && (val.type === "arrow_function" || val.type === "function" || val.type === "function_expression")) {
          add(nm.text, "function", d);
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) walk(c); }
  };
  walk(parsed.tree.rootNode);

  // 호출 수집 — call 노드마다 대상 이름 + 감싼 심볼(범위 내포, 최내곽). 모듈레벨 호출은 버림.
  // 최내곽 = 범위 좁은 심볼(메서드가 클래스보다 우선). 심볼을 범위 큰→작은 정렬 후 마지막 내포가 최내곽.
  const byRange = [...symbols].sort((a, b) => (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));
  const containerOf = (idx: number): string | null => {
    let hit: string | null = null;
    for (const s of byRange) if (idx >= s.startIndex && idx < s.endIndex) hit = s.id; // 좁은 게 뒤 → 덮어씀
    return hit;
  };
  const calls: RawCall[] = [];
  const seenCall = new Set<string>();
  const walkCalls = (node: Parser.SyntaxNode) => {
    if (node.type === "call_expression" || node.type === "call" || node.type === "call_expression_statement") {
      const fn = node.childForFieldName("function") ?? node.childForFieldName("method") ?? node.namedChild(0);
      const name = fn ? calleeNameOf(fn) : null;
      const caller = containerOf(node.startIndex);
      if (name && caller) {
        const key = `${caller}|${name}`;
        if (!seenCall.has(key)) { seenCall.add(key); calls.push({ callerId: caller, calleeName: name }); }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) walkCalls(c); }
  };
  walkCalls(parsed.tree.rootNode);

  const nodes: RepoNode[] = symbols.map((s) => ({ id: s.id, label: s.name, file, kind: s.kind }));
  const contains: RepoEdge[] = symbols.map((s) => ({ source: file, target: s.id, relation: "contains" }));
  return { symbols, nodes, contains, calls };
}

// 원시 호출 → calls 엣지. 대상 해석: 같은 파일 심볼 우선, 없으면 import한 파일들 심볼 테이블서 이름 매칭.
// best-effort(동명이인은 in-file 우선 → 첫 import 매칭). importedSymbols: 해석된 import 파일 → 그 파일 심볼들.
export function resolveCalls(
  calls: RawCall[],
  localSymbols: SymbolInfo[],
  importedSymbols: Map<string, SymbolInfo[]>,
): RepoEdge[] {
  const localByName = new Map<string, string>(); // 이름 → id(첫 것)
  for (const s of localSymbols) if (!localByName.has(s.name)) localByName.set(s.name, s.id);
  // import 파일별 이름→id(첫 것).
  const importByName = new Map<string, string>();
  for (const syms of importedSymbols.values()) for (const s of syms) if (!importByName.has(s.name)) importByName.set(s.name, s.id);

  const edges: RepoEdge[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    const target = localByName.get(c.calleeName) ?? importByName.get(c.calleeName);
    if (!target || target === c.callerId) continue; // 미해결·자기호출 스킵
    const key = `${c.callerId}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: c.callerId, target, relation: "calls" });
  }
  return edges;
}
