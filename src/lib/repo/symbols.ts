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

// 소스+파일 → 심볼 목록 + 노드 + contains 엣지(file→symbol). 미지원 언어면 빈 결과.
export async function extractSymbols(text: string, file: string): Promise<{ symbols: SymbolInfo[]; nodes: RepoNode[]; contains: RepoEdge[] }> {
  const parsed = await parseFile(text, file);
  if (!parsed) return { symbols: [], nodes: [], contains: [] };

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

  const nodes: RepoNode[] = symbols.map((s) => ({ id: s.id, label: s.name, file, kind: s.kind }));
  const contains: RepoEdge[] = symbols.map((s) => ({ source: file, target: s.id, relation: "contains" }));
  return { symbols, nodes, contains };
}
