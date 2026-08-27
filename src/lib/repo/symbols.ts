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
  owner?: string;      // 감싼 클래스 이름(#843 scope-aware) — this/self 멤버 호출을 이 클래스로 한정
  signature?: string;  // 함수/메서드 시그니처(파라미터+반환타입, #843)
  startIndex: number;  // 바이트 범위(호출 스코프 판정·소스 조각용)
  endIndex: number;
  startRow: number;    // 표시용(1-based 아님, tree-sitter 0-based)
}

// 원시 호출 — 아직 대상 미해결. callerId=이 호출을 감싼 심볼(없으면 null=모듈레벨, 버림).
// member=this/self.x() 형태(대상이 caller의 소속 클래스 메서드) vs bare foo()(#843 Graft owner 기법).
export interface RawCall { callerId: string; calleeName: string; member: boolean }

// 원시 상속 — classId(하위 클래스 심볼 id) → baseName(상위 이름, 미해결). relation=extends|implements(#843).
export interface RawHeritage { classId: string; baseName: string; relation: "extends" | "implements" }

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

// 함수/메서드 시그니처 — 파라미터 목록(+반환 타입). grammar별 필드명 차이 흡수(공통 후보).
function signatureOf(node: Parser.SyntaxNode, name: string): string | undefined {
  const params = node.childForFieldName("parameters")
    ?? node.namedChildren.find((c) => c && /parameters|parameter_list|argument_list/.test(c.type));
  if (!params) return undefined;
  // 반환 타입: TS type_annotation / Go result / Java type 등 — 있으면 뒤에 붙임(best-effort).
  const ret = node.childForFieldName("return_type")
    ?? node.namedChildren.find((c) => c && /type_annotation|return/.test(c.type));
  const sig = `${name}${params.text.replace(/\s+/g, " ")}${ret ? ` ${ret.text.replace(/\s+/g, " ")}` : ""}`;
  return sig.length > 200 ? sig.slice(0, 200) : sig; // 과도한 길이 컷
}

// 호출식의 대상 — bare identifier(foo()) 또는 this/self 멤버(this.bar())만.
// 임의 객체 멤버(arr.push, xs.map)는 null — 빌트인/타 객체 메서드가 동명 로컬 심볼로 오연결되는 노이즈 차단(리뷰).
// member=true면 this/self.x() → resolve서 caller의 소속 클래스 메서드로만 한정(#843 scope-aware).
function calleeNameOf(fn: Parser.SyntaxNode): { name: string; member: boolean } | null {
  if (fn.type === "identifier") return { name: fn.text, member: false };
  const obj = fn.childForFieldName("object") ?? fn.childForFieldName("receiver") ?? fn.namedChild(0);
  const prop = fn.childForFieldName("property") ?? fn.childForFieldName("field") ?? fn.childForFieldName("name");
  if (obj && /^(this|self)$/.test(obj.text) && prop?.text) return { name: prop.text, member: true }; // this.x / self.x
  return null;
}

// 소스+파일 → 심볼 목록 + 노드 + contains 엣지(file→symbol) + 원시 호출. 미지원 언어면 빈 결과.
export async function extractSymbols(text: string, file: string): Promise<{ symbols: SymbolInfo[]; nodes: RepoNode[]; contains: RepoEdge[]; calls: RawCall[]; heritage: RawHeritage[] }> {
  const parsed = await parseFile(text, file);
  if (!parsed) return { symbols: [], nodes: [], contains: [], calls: [], heritage: [] };

  const symbols: SymbolInfo[] = [];
  const usedIds = new Set<string>();
  const nodeById = new Map<string, Parser.SyntaxNode>(); // id → AST 노드(heritage 추출용)
  const add = (name: string, kind: RepoNodeKind, node: Parser.SyntaxNode) => {
    let id = `${file}#${name}`;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${id}:${n}`)) n++; id = `${id}:${n}`; } // 동명 심볼 유일화
    usedIds.add(id);
    const signature = kind === "function" ? signatureOf(node, name) : undefined;
    symbols.push({ id, name, kind, ...(signature ? { signature } : {}), startIndex: node.startIndex, endIndex: node.endIndex, startRow: node.startPosition.row });
    nodeById.set(id, node);
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

  // 범위 정렬(큰→작은) — 최내곽 판정 공용. 좁은 게 뒤 → 덮어써 최내곽.
  const byRange = [...symbols].sort((a, b) => (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));
  const containerOf = (idx: number): string | null => {
    let hit: string | null = null;
    for (const s of byRange) if (idx >= s.startIndex && idx < s.endIndex) hit = s.id;
    return hit;
  };
  // owner(#843) — 각 심볼을 감싼 최내곽 class 심볼의 이름. this/self 멤버 호출을 그 클래스로 한정하는 데 씀.
  const ownerOf = (s: SymbolInfo): string | undefined => {
    let hit: string | undefined;
    for (const c of byRange) {
      if (c.id === s.id || c.kind !== "class") continue;
      if (s.startIndex >= c.startIndex && s.endIndex <= c.endIndex) hit = c.name; // 더 좁은 class가 뒤 → 덮어씀
    }
    return hit;
  };
  for (const s of symbols) s.owner = ownerOf(s);

  const calls: RawCall[] = [];
  const seenCall = new Set<string>();
  const walkCalls = (node: Parser.SyntaxNode) => {
    if (node.type === "call_expression" || node.type === "call" || node.type === "call_expression_statement") {
      const fn = node.childForFieldName("function") ?? node.childForFieldName("method") ?? node.namedChild(0);
      const callee = fn ? calleeNameOf(fn) : null;
      const caller = containerOf(node.startIndex);
      if (callee && caller) {
        const key = `${caller}|${callee.name}|${callee.member ? 1 : 0}`;
        if (!seenCall.has(key)) { seenCall.add(key); calls.push({ callerId: caller, calleeName: callee.name, member: callee.member }); }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) walkCalls(c); }
  };
  walkCalls(parsed.tree.rootNode);

  // 상속(#843) — class 심볼의 heritage 추출. TS: class_heritage>extends_clause/implements_clause,
  // Python: class_definition>argument_list(bases=extends), Java: superclass/super_interfaces.
  const heritage: RawHeritage[] = [];
  for (const s of symbols) {
    if (s.kind !== "class") continue;
    const node = nodeById.get(s.id);
    if (!node) continue;
    const pushBases = (container: Parser.SyntaxNode | null | undefined, relation: "extends" | "implements") => {
      if (!container) return;
      for (let i = 0; i < container.namedChildCount; i++) {
        const c = container.namedChild(i);
        if (c && /identifier/.test(c.type) && c.text) heritage.push({ classId: s.id, baseName: c.text.replace(/<.*$/, ""), relation });
      }
    };
    const heritageNode = node.namedChildren.find((c) => c?.type === "class_heritage");
    if (heritageNode) { // TS/JS
      pushBases(heritageNode.namedChildren.find((c) => c?.type === "extends_clause"), "extends");
      pushBases(heritageNode.namedChildren.find((c) => c?.type === "implements_clause"), "implements");
    }
    pushBases(node.childForFieldName("superclass"), "extends");        // Java extends / Python bases(field 없으면 아래)
    pushBases(node.childForFieldName("interfaces") ?? node.childForFieldName("super_interfaces"), "implements"); // Java
    if (!heritageNode) pushBases(node.namedChildren.find((c) => c?.type === "argument_list"), "extends"); // Python bases
  }

  parsed.tree.delete(); // heritage 추출까지 끝 — 이제 WASM tree 해제(노드 접근 불가, freed 메모리).

  const nodes: RepoNode[] = symbols.map((s) => ({ id: s.id, label: s.name, file, kind: s.kind, ...(s.owner ? { owner: s.owner } : {}), ...(s.signature ? { signature: s.signature } : {}) }));
  const contains: RepoEdge[] = symbols.map((s) => ({ source: file, target: s.id, relation: "contains" }));
  return { symbols, nodes, contains, calls, heritage };
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
  // #843 scope-aware: owner 클래스별 메서드 인덱스 + caller id→owner. this/self 호출을 소속 클래스로 한정.
  // first-wins(로컬/import 이름 해석과 동일 정책, 결정적). 오버로드(Java만)·동명 재정의는 arity 없이는 단일 엣지로
  // 정확 구분 불가 → 첫 정의로 해석(문서화된 한계, 리뷰 🟡). arity 기반 구분은 후속(Graft resolve.ts 참고).
  const byOwnerName = new Map<string, string>(); // "Owner.method" → id(첫 것)
  const ownerOfId = new Map<string, string>();    // symbol id → owner 클래스
  for (const s of localSymbols) {
    if (s.owner) { ownerOfId.set(s.id, s.owner); const k = `${s.owner}.${s.name}`; if (!byOwnerName.has(k)) byOwnerName.set(k, s.id); }
  }

  const edges: RepoEdge[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    let target: string | undefined;
    if (c.member) {
      // this/self.x() — caller의 소속 클래스 메서드로만. 없으면 미해결(bare 이름 추측 금지, Graft 원칙).
      const owner = ownerOfId.get(c.callerId);
      target = owner ? byOwnerName.get(`${owner}.${c.calleeName}`) : undefined;
    } else {
      // bare foo() — 로컬 이름 우선, 없으면 import.
      target = localByName.get(c.calleeName) ?? importByName.get(c.calleeName);
    }
    if (!target || target === c.callerId) continue; // 미해결·자기호출 스킵
    const key = `${c.callerId}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: c.callerId, target, relation: "calls" });
  }
  return edges;
}
