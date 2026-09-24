// src/session-addresses.js
//
// Registry of Claude Code cross-session addresses — the string another session
// passes to SendMessage's `to` field to reach this one (e.g. "agent-triage-b7
// [40e5ca]"). That name lives in the Claude Code harness and appears in no data
// source the dashboard can read: cmux's socket RPC knows only workspace titles,
// directories, branches and refs. A session is the only party that knows its
// own address, so it reports it in (see bin/hooks/session-address.sh) and this
// registry holds what came back.
//
// Keyed by tty rather than directory: two panes open on the same repo share a
// directory but never a tty, and the hooks can resolve their own pane's tty
// cheaply (bin/hooks/lib/resolve-pane-tty.sh).
//
// In-memory only, deliberately. A dead session's address surviving a restart on
// disk is exactly the kind of drift the Integrations contract forbids — a card
// would offer an address that silently goes nowhere. Live sessions re-report on
// their next turn, so the cost of forgetting is one turn of staleness.

/** Registrations go stale this long after they were last confirmed alive.
 *
 * Confirmation comes from two places, so this is a backstop rather than the
 * primary mechanism: the monitor's per-poll tty reconciliation (a pane cmux
 * still reports is alive no matter how long the session has been working on one
 * prompt), and the heartbeat hook. It only actually expires anything when
 * reconciliation has stopped happening — cmux unreadable, monitor stopped —
 * which is exactly when a registration can no longer be trusted. */
export const ADDRESS_TTL_MS = 10 * 60 * 1000;

export class SessionAddresses {
  #byTty = new Map();

  /** Record (or refresh) the address a session reported for its own pane. */
  register(tty, address, now = Date.now()) {
    if (!tty || !address) return null;
    const entry = { tty, address, updatedAt: now };
    this.#byTty.set(tty, entry);
    return entry;
  }

  /** Liveness ping from a session that already registered. Deliberately does
   * not create an entry: the heartbeat hook is shell-only and carries no
   * address, so treating it as a registration would record an empty one.
   * Returns whether there was anything to refresh. */
  heartbeat(tty, now = Date.now()) {
    const entry = this.#byTty.get(tty);
    if (!entry) return false;
    entry.updatedAt = now;
    return true;
  }

  unregister(tty) {
    return this.#byTty.delete(tty);
  }

  /** The address registered for `tty`, or null when there is none or it has
   * aged past the TTL. */
  get(tty, now = Date.now()) {
    const entry = this.#byTty.get(tty);
    if (!entry) return null;
    if (now - entry.updatedAt > ADDRESS_TTL_MS) return null;
    return entry.address;
  }

  /** Drops registrations whose tty cmux no longer reports, and refreshes the
   * ones it does. Called once per monitor poll with the live tty set, so a pane
   * that went away takes its address with it even if the session never got to
   * run its SessionEnd hook.
   *
   * Refreshing live entries is what keeps the TTL from measuring "time since
   * the user last typed": an autonomous run (flow-dev, loops, /goal) can spend
   * hours on a single prompt, and its pane being alive is the liveness fact
   * that matters. Callers must only ever pass a set they actually read from
   * cmux — an empty set means "no panes", never "cmux didn't answer". */
  prune(liveTtys, now = Date.now()) {
    const live = liveTtys instanceof Set ? liveTtys : new Set(liveTtys || []);
    let removed = 0;
    for (const [tty, entry] of this.#byTty) {
      if (live.has(tty)) {
        entry.updatedAt = now;
        continue;
      }
      this.#byTty.delete(tty);
      removed++;
    }
    return removed;
  }

  get size() {
    return this.#byTty.size;
  }
}
