/** Pointer Lock is optional, especially in mobile and embedded browsers. */
export function exitPointerLock(target: { exitPointerLock?: () => void }) {
  try { target.exitPointerLock?.(); } catch { /* A missing/denied mouse API must never interrupt room lifecycle updates. */ }
}
