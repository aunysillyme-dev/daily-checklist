import {parseState, type State} from './model.ts';

export type MemoryStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
export type RunLock = <T>(fn: () => Promise<T>) => Promise<T>;
export type CommitResult = {ok: true; state: State} | {ok: false; reason: 'invalid' | 'conflict'; state?: State};

const LOCK_NAME = 'auny-daily-checklist';

export function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (globalThis.isSecureContext && nav?.locks) return nav.locks.request(LOCK_NAME, () => fn()) as Promise<T>;
  return fn();
}

export async function commitChecked(store: MemoryStore, key: string, base: string | null, next: State, lock?: RunLock): Promise<CommitResult> {
  const run = async (): Promise<CommitResult> => {
    let clean: State;
    try { clean = parseState(JSON.stringify(next)); }
    catch { return {ok: false, reason: 'invalid'}; }
    const current = store.getItem(key);
    if (current !== base) {
      let state: State | undefined;
      if (current !== null) { try { state = parseState(current); } catch { /* The caller reports unreadable storage. */ } }
      return {ok: false, reason: 'conflict', state};
    }
    store.setItem(key, JSON.stringify(clean));
    return {ok: true, state: clean};
  };
  return lock ? lock(run) : run();
}

export function adoptExternal(raw: string | null, fallback: State): {ok: true; state: State; base: string | null} {
  if (raw === null) return {ok: true, state: fallback, base: null};
  return {ok: true, state: parseState(raw), base: raw};
}
