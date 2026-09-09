import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startHeartbeat, sweepClients } from "../src/heartbeat.js";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.pings = 0;
    this.terminated = false;
  }
  ping() { this.pings++; }
  terminate() { this.terminated = true; }
}

class FakeServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }
  accept() {
    const socket = new FakeSocket();
    this.clients.add(socket);
    this.emit("connection", socket);
    return socket;
  }
}

function withHeartbeat(fn) {
  const wss = new FakeServer();
  const stop = startHeartbeat(wss, { intervalMs: 60000 });
  try {
    fn(wss);
  } finally {
    stop();
  }
}

describe("heartbeat", () => {
  it("pings every connected client on a sweep", () => {
    withHeartbeat((wss) => {
      const a = wss.accept();
      const b = wss.accept();
      assert.equal(sweepClients(wss), 0);
      assert.equal(a.pings, 1);
      assert.equal(b.pings, 1);
      assert.equal(a.terminated, false);
      assert.equal(b.terminated, false);
    });
  });

  it("keeps a client that answers with a pong", () => {
    withHeartbeat((wss) => {
      const socket = wss.accept();
      sweepClients(wss);
      socket.emit("pong");
      sweepClients(wss);
      assert.equal(socket.terminated, false);
      assert.equal(socket.pings, 2);
    });
  });

  it("terminates a client that missed the previous ping", () => {
    withHeartbeat((wss) => {
      const socket = wss.accept();
      sweepClients(wss);
      assert.equal(socket.terminated, false);
      assert.equal(sweepClients(wss), 1);
      assert.equal(socket.terminated, true);
      assert.equal(socket.pings, 1);
    });
  });

  it("terminates only the unresponsive clients", () => {
    withHeartbeat((wss) => {
      const live = wss.accept();
      const dead = wss.accept();
      sweepClients(wss);
      live.emit("pong");
      assert.equal(sweepClients(wss), 1);
      assert.equal(dead.terminated, true);
      assert.equal(live.terminated, false);
    });
  });

  it("survives a client whose ping throws", () => {
    withHeartbeat((wss) => {
      const socket = wss.accept();
      socket.ping = () => { throw new Error("socket gone"); };
      assert.doesNotThrow(() => sweepClients(wss));
    });
  });
});
