import type { CodeToken, ConceptOccurrence, ItTerm } from "@/lib/translator/types";

// 출처 종류 — 출처로 이동 목적지 분기용.
// analysis: 코드/글 분석(챗 세션까지). card: 플래시카드 챗에서 생성(생성처 카드로).
// ask: 에이전트 질문 모드(세션+질문으로). workspace: 워크스페이스 챗(세션별 카드 목록, #750).
export type SourceKind = "analysis" | "card" | "ask" | "workspace";

// 출처 부가 정보(옵셔널) — sourceTitle/sourceId 외 확장. 챗에서 카드 생성 시 채운다.
export interface SourceExtra {
  kind?: SourceKind;
  sessionId?: string; // analysis: 그 분석의 챗 세션 id / ask: 질문 세션 id
  originCardKey?: string; // card: 생성처(그 챗룸을 연) 카드 key
  subId?: string; // ask: 카드가 생성된 질문(서브세션) id
  root?: string; // workspace: 카드를 만든 레포 절대경로 — 세션 카드 목록 레포별 격리용(#762)
}

// 북마크 detail 공통 출처 필드(전부 옵셔널 — 기존 데이터 하위호환).
interface SourceFields {
  sourceTitle?: string; // 담을 때의 분석 제목(출처)
  sourceId?: string; // 담을 때의 분석 히스토리 id(출처로 이동용)
  sourceKind?: SourceKind; // 없으면 analysis로 간주(기존 동작)
  sourceSessionId?: string; // analysis 출처의 챗 세션 id / ask 질문 세션 id
  originCardKey?: string; // card 출처의 생성처 카드 key
  sourceSubId?: string; // ask 출처의 질문(서브세션) id
  sourceRoot?: string; // workspace 출처의 레포 절대경로 — 세션 카드 목록 레포별 격리용(#762)
}

export interface BookmarkedTokenDetail extends CodeToken, SourceFields {
  bookmarkedAt: string;
}

// 글(IT 용어) 모드 북마크 — 코드 토큰 북마크와 다른 키에 저장해 모드별로 분리한다.
export interface BookmarkedTermDetail extends ItTerm, SourceFields {
  bookmarkedAt: string;
}

// 개념 북마크 — 코드 모드 개념. 키 = 개념 title.
export interface BookmarkedConceptDetail extends ConceptOccurrence, SourceFields {
  bookmarkedAt: string;
}

// 저장 시 detail에 얹을 출처 필드 묶음.
function sourceFields(sourceTitle?: string, sourceId?: string, extra?: SourceExtra): SourceFields {
  return {
    sourceTitle,
    sourceId,
    sourceKind: extra?.kind,
    sourceSessionId: extra?.sessionId,
    originCardKey: extra?.originCardKey,
    sourceSubId: extra?.subId,
    sourceRoot: extra?.root,
  };
}

const DETAILS_KEY = "nunopi:bookmark-token-details";
const TERM_DETAILS_KEY = "nunopi:bookmark-term-details";
const CONCEPT_DETAILS_KEY = "nunopi:bookmark-concept-details";

export function saveTokenDetail(token: CodeToken, sourceTitle?: string, sourceId?: string, extra?: SourceExtra): void {
  try {
    const existing = loadTokenDetails();
    existing[token.token] = { ...token, bookmarkedAt: new Date().toISOString(), ...sourceFields(sourceTitle, sourceId, extra) };
    localStorage.setItem(DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function removeTokenDetail(tokenText: string): void {
  try {
    const existing = loadTokenDetails();
    delete existing[tokenText];
    localStorage.setItem(DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function loadTokenDetails(): Record<string, BookmarkedTokenDetail> {
  try {
    const raw = localStorage.getItem(DETAILS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BookmarkedTokenDetail>) : {};
  } catch {
    return {};
  }
}

export function clearTokenDetails(): void {
  try { localStorage.removeItem(DETAILS_KEY); } catch { /* ignore */ }
}

// --- 글 모드 IT 용어 북마크 (키 = term 문자열) ---

export function saveTermDetail(term: ItTerm, sourceTitle?: string, sourceId?: string, extra?: SourceExtra): void {
  try {
    const existing = loadTermDetails();
    existing[term.term] = { ...term, bookmarkedAt: new Date().toISOString(), ...sourceFields(sourceTitle, sourceId, extra) };
    localStorage.setItem(TERM_DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function removeTermDetail(termText: string): void {
  try {
    const existing = loadTermDetails();
    delete existing[termText];
    localStorage.setItem(TERM_DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function loadTermDetails(): Record<string, BookmarkedTermDetail> {
  try {
    const raw = localStorage.getItem(TERM_DETAILS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BookmarkedTermDetail>) : {};
  } catch {
    return {};
  }
}

export function clearTermDetails(): void {
  try { localStorage.removeItem(TERM_DETAILS_KEY); } catch { /* ignore */ }
}

// --- 개념 북마크 (키 = 개념 title) ---

export function saveConceptDetail(concept: ConceptOccurrence, sourceTitle?: string, sourceId?: string, extra?: SourceExtra): void {
  try {
    const existing = loadConceptDetails();
    existing[concept.title] = { ...concept, bookmarkedAt: new Date().toISOString(), ...sourceFields(sourceTitle, sourceId, extra) };
    localStorage.setItem(CONCEPT_DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function removeConceptDetail(title: string): void {
  try {
    const existing = loadConceptDetails();
    delete existing[title];
    localStorage.setItem(CONCEPT_DETAILS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

export function loadConceptDetails(): Record<string, BookmarkedConceptDetail> {
  try {
    const raw = localStorage.getItem(CONCEPT_DETAILS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BookmarkedConceptDetail>) : {};
  } catch {
    return {};
  }
}

export function clearConceptDetails(): void {
  try { localStorage.removeItem(CONCEPT_DETAILS_KEY); } catch { /* ignore */ }
}

// 카드 중복 검사용 정규화(#511): 소문자 + 괄호 `(...)` 안 내용 제거 + 공백 전부 제거.
// 표기/공백/대소문자 + 괄호 영문표기 차이를 흡수한다. 예: "컴파일 (Compile)"·"컴파일(Compile)"
// ·"컴파일" → 모두 "컴파일"(중복). "컴파일러(Compiler)" → "컴파일러"(다른 단어라 별개).
export function normalizeCardFront(s: string): string {
  return s.trim().toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
}

// 주어진 store에 front와 정규화상 같은 카드가 이미 있는지(소스별 중복 검사).
function existsNormalized(load: () => Record<string, unknown>, front: string): boolean {
  const n = normalizeCardFront(front);
  if (!n) return false;
  return Object.keys(load()).some((k) => normalizeCardFront(k) === n);
}
export function tokenExistsNormalized(front: string): boolean {
  return existsNormalized(loadTokenDetails, front);
}
export function conceptExistsNormalized(front: string): boolean {
  return existsNormalized(loadConceptDetails, front);
}
export function termExistsNormalized(front: string): boolean {
  return existsNormalized(loadTermDetails, front);
}

// 이미 북마크(카드)로 존재하는 용어인지 — store 3종 아무 데나 있으면 true(정규화 매칭).
// 챗 카드 제안 칩에서 "이미 있는 카드"(표기 변형 포함)는 다시 제안 안 하도록 필터링용.
export function bookmarkedTermExists(term: string): boolean {
  return tokenExistsNormalized(term) || conceptExistsNormalized(term) || termExistsNormalized(term);
}

// --- 출처 소급 채움 ---
// 이미 담긴 북마크(신규 추가가 아니라 예전에 담아 sourceTitle이 없는 것)를, 그 용어가
// 등장한 분석을 다시 볼 때 현재 분석 제목으로 채운다. 이미 값이 있으면 건드리지 않는다(최초 출처 보존).
// 반환: 하나라도 채웠으면 true(호출부가 화면 상태 갱신할지 판단).
function backfill<T extends { sourceTitle?: string; sourceId?: string }>(
  key: string,
  map: Record<string, T>,
  itemKey: string,
  title: string,
  id?: string,
): boolean {
  const entry = map[itemKey];
  if (!entry) return false;
  // 이미 sourceTitle 있으면 최초 출처 보존(제목은 손대지 않음). 단, id만 빠진 옛 데이터엔 id를 채운다.
  let changed = false;
  if (!entry.sourceTitle) { entry.sourceTitle = title; changed = true; }
  if (id && !entry.sourceId) { entry.sourceId = id; changed = true; }
  if (!changed) return false;
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
  return true;
}

export function backfillTokenSource(tokenText: string, title: string, id?: string): boolean {
  return backfill(DETAILS_KEY, loadTokenDetails(), tokenText, title, id);
}
export function backfillTermSource(termText: string, title: string, id?: string): boolean {
  return backfill(TERM_DETAILS_KEY, loadTermDetails(), termText, title, id);
}
export function backfillConceptSource(title0: string, title: string, id?: string): boolean {
  return backfill(CONCEPT_DETAILS_KEY, loadConceptDetails(), title0, title, id);
}

// 질문(sub)이 다른 세션으로 이동할 때 — 그 질문에서 만든 카드들의 sourceSessionId를 새 세션으로 재지정(#556).
// 카드는 sourceSubId(질문 id, 이동해도 불변)로 식별. token/term/concept 3맵 전부 훑는다.
export function reassignAskSubSession(subId: string, toSessionId: string): void {
  for (const key of [DETAILS_KEY, TERM_DETAILS_KEY, CONCEPT_DETAILS_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const map = JSON.parse(raw) as Record<string, SourceFields>;
      let changed = false;
      for (const v of Object.values(map)) {
        if (v && v.sourceSubId === subId) { v.sourceSessionId = toSessionId; changed = true; }
      }
      if (changed) localStorage.setItem(key, JSON.stringify(map));
    } catch { /* ignore */ }
  }
}
