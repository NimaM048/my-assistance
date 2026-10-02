// A tiny state store shared by every Coucou window.
//
// All windows load from the same origin, so they share localStorage, and the
// browser fires a `storage` event in the *other* windows whenever one writes.
// That is enough to keep the island, the Hub and Settings in sync — Mochi's
// outfit, its XP, the day review — without any round trip through Rust, and
// nothing ever leaves this PC.

export interface SharedStore<T> {
  read(): T;
  /** Shallow-merges a patch (or the result of an updater) and notifies everyone. */
  write(patch: Partial<T> | ((current: T) => Partial<T>)): T;
  /** Called for writes from this window and from any other Coucou window. */
  subscribe(fn: (value: T) => void): () => void;
}

export function sharedStore<T extends object>(key: string, defaults: () => T, normalize?: (raw: Partial<T>) => T): SharedStore<T> {
  const listeners = new Set<(value: T) => void>();

  const read = (): T => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<T> | null;
      const merged = { ...defaults(), ...(raw ?? {}) } as T;
      return normalize ? normalize(merged) : merged;
    } catch {
      return defaults();
    }
  };

  const write = (patch: Partial<T> | ((current: T) => Partial<T>)): T => {
    const current = read();
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) } as T;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage can be unavailable; the change still applies to this window */
    }
    for (const fn of listeners) fn(next);
    return next;
  };

  const subscribe = (fn: (value: T) => void) => {
    listeners.add(fn);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) fn(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { read, write, subscribe };
}
