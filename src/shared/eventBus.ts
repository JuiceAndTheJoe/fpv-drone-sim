/**
 * Tiny typed pub/sub for cross-stream signals.
 * Avoids each stream having to import the others directly.
 */
import type { EventMap, EventName } from './types.ts';

type Listener<K extends EventName> = (payload: EventMap[K]) => void;
type AnyListener = (payload: unknown) => void;

const listeners = new Map<EventName, Set<AnyListener>>();

export function on<K extends EventName>(event: K, fn: Listener<K>): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  const wrapped = fn as unknown as AnyListener;
  set.add(wrapped);
  return () => set!.delete(wrapped);
}

export function emit<K extends EventName>(event: K, payload: EventMap[K]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) (fn as unknown as Listener<K>)(payload);
}

export function clearAll(): void {
  listeners.clear();
}
