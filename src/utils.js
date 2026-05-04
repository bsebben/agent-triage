// src/tabs/poll.js — Shared polling utility for tab modules
export function startPolling(name, pollFn, onUpdate, intervalMs) {
  const doPoll = async () => {
    try { await pollFn(); onUpdate(); }
    catch (err) { console.error(`${name} poll error:`, err.message); }
  };
  doPoll();
  setInterval(doPoll, intervalMs);
  return doPoll;
}
