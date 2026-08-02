// STATE MANAGEMENT: the previous version spread mutable state across
// several independent top-level `let`/`const` bindings (authToken,
// authUsername, allPoints, markerRefs) that were read and written directly
// from a dozen different places with no single source of truth - e.g.
// login/logout had to remember to manually call renderTable() AND rebuild
// every marker. A tiny store makes "what can change" and "who reacts to
// it" explicit: components subscribe once and re-render only when the
// slice of state they care about actually changes.

export function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach(fn => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
