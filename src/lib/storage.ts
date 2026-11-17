import type { Session } from "./session";

/**
 * Salvataggio delle sessioni nel browser (localStorage).
 * L'app è per uso personale: i dati restano su questo browser.
 */

const INDEX_KEY = "bt:index:v1";
const sessionKey = (id: string) => `bt:session:v1:${id}`;

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readIndex(): string[] {
  try {
    const raw = ls()?.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  ls()?.setItem(INDEX_KEY, JSON.stringify(ids));
}

export function listSessions(): Session[] {
  const out: Session[] = [];
  for (const id of readIndex()) {
    const s = loadSession(id);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): Session | null {
  try {
    const raw = ls()?.getItem(sessionKey(id));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): boolean {
  const store = ls();
  if (!store) return false;
  try {
    const updated = { ...s, updatedAt: Math.floor(Date.now() / 1000) };
    store.setItem(sessionKey(s.id), JSON.stringify(updated));
    const ids = readIndex();
    if (!ids.includes(s.id)) writeIndex([s.id, ...ids]);
    return true;
  } catch {
    return false;
  }
}

export function deleteSession(id: string) {
  const store = ls();
  if (!store) return;
  store.removeItem(sessionKey(id));
  writeIndex(readIndex().filter((x) => x !== id));
}

export function newId(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return rnd.replace(/-/g, "").slice(0, 12);
}
