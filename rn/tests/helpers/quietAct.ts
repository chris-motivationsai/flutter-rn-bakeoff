// Screens finish their work after real I/O (SQLite, HTTP to the test server), outside React's act().
// The tests wait for the visible result with waitFor, so the act() reminder is noise here.
const original = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
  original(...args);
};
