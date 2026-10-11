// Tiny global event bus so systems (player, HUD, audio, FX) stay decoupled.
// See ARCHITECTURE.md "Events" for the list of event names and payloads.
const listeners = new Map();

export const events = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => events.off(name, fn);
  },
  off(name, fn) {
    listeners.get(name)?.delete(fn);
  },
  emit(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] listener for "${name}" failed`, err);
      }
    }
  },
};
