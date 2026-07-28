import type { AgentAnalyzeResponse, AgentProviderKind, AnalyzeMode, ChatMessage } from "@/lib/agent";

// 학습 챗 세션 — 한 분석 안에서 주제별로 나눈 독립 대화 묶음(#312).
// 이름은 저장하지 않고 배열 인덱스+1로 "세션 N" 라벨링한다.
export interface ChatSession {
  id: string;
  messages: ChatMessage[];
}

export interface HistoryEntry {
  id: string;
  code: string;
  providerId: AgentProviderKind;
  mode?: AnalyzeMode; // 기본 "code". Issue 76에서 모드별 필터에 사용.
  result: AgentAnalyzeResponse;
  chat?: ChatMessage[]; // (deprecated) 구 단일 챗 스레드 — chatSessions 마이그레이션 소스로만 읽음.
  chatSessions?: ChatSession[]; // 학습 챗 세션 목록(분석마다 보존, #312).
  activeChatSessionId?: string; // 마지막으로 보던 세션 id.
  collectionIds?: string[]; // 속한 사용자 목록(카테고리) id들.
  incomplete?: boolean; // 멈춰서 부분만 저장된 미완 분석(이어서 가능).
  createdAt: string;
  isPinned?: boolean;
  title?: string;
  pinnedLine?: number; // 줄별설명 책갈피 — "여기까지 봤음"(코드 모드, 분석당 1개). #639
}

function newSessionId(): string {
  try { return crypto.randomUUID(); } catch { return `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }
}

// 엔트리의 챗을 세션 목록으로 정규화(항상 ≥1 세션 보장).
// 구 `chat` 단일 스레드는 세션 1개로 흡수. 둘 다 없으면 빈 세션 1개.
export function entryChatSessions(entry: Pick<HistoryEntry, "chat" | "chatSessions">): ChatSession[] {
  if (entry.chatSessions && entry.chatSessions.length > 0) return entry.chatSessions;
  if (entry.chat && entry.chat.length > 0) return [{ id: newSessionId(), messages: entry.chat }];
  return [{ id: newSessionId(), messages: [] }];
}

// 빈 세션 1개로 시작하는 새 세션 목록(새 분석/클리어용).
export function freshChatSessions(): ChatSession[] {
  return [{ id: newSessionId(), messages: [] }];
}

export { newSessionId };

const DB_NAME = "nunopi-history";
const DB_VERSION = 1;
const STORE_NAME = "analyses";
const MAX_ENTRIES = 20;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

export async function saveToHistory(
  entry: Omit<HistoryEntry, "id">,
): Promise<string> {
  const db = await openDB();
  const id = crypto.randomUUID();
  const full: HistoryEntry = { ...entry, id };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(full);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  db.close();

  // trim only unpinned entries to MAX_ENTRIES
  const all = await getAllHistory();
  const unpinned = all.filter((e) => !e.isPinned);
  if (unpinned.length > MAX_ENTRIES) {
    const toDelete = unpinned.slice(MAX_ENTRIES);
    for (const e of toDelete) {
      await deleteFromHistory(e.id);
    }
  }
  return id;
}

export async function getAllHistory(): Promise<HistoryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const entries = (req.result as HistoryEntry[]).sort((a, b) => {
        // pinned first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        // then by recency
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        if (isNaN(ta) || isNaN(tb)) return 0;
        return tb - ta;
      });
      resolve(entries);
      db.close();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateHistory(
  id: string,
  changes: Partial<Pick<HistoryEntry, "isPinned" | "title" | "result" | "chat" | "chatSessions" | "activeChatSessionId" | "collectionIds" | "incomplete" | "pinnedLine">>,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as HistoryEntry | undefined;
      if (!existing) { resolve(); db.close(); return; }
      const updated: HistoryEntry = { ...existing, ...changes };
      const putReq = store.put(updated);
      putReq.onsuccess = () => { resolve(); db.close(); };
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteFromHistory(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => { resolve(); db.close(); };
    req.onerror = () => reject(req.error);
  });
}

// mode를 주면 해당 모드 항목만, 안 주면 전체를 삭제한다(모드별 분리 삭제).
export async function clearHistory(mode?: AnalyzeMode): Promise<void> {
  if (mode) {
    const all = await getAllHistory();
    const targets = all.filter((e) => (e.mode ?? "code") === mode);
    for (const e of targets) {
      await deleteFromHistory(e.id);
    }
    return;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => { resolve(); db.close(); };
    req.onerror = () => reject(req.error);
  });
}
