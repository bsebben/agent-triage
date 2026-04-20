import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { enrichNotification, parseScreenForQuestion } from "../src/monitor.js";

describe("parseScreenForQuestion", () => {
  it("extracts question text and options from screen content", () => {
    const screen = [
      "Some output above",
      "",
      '  "Which test approach should we use?"',
      "",
      "  ❯ Unit tests only",
      "    Integration tests",
      "    Both unit and integration",
      "    Other",
    ].join("\n");

    const result = parseScreenForQuestion(screen);
    assert.ok(result);
    assert.ok(result.question.includes("Which test approach"));
    assert.ok(result.options.length >= 3);
  });

  it("returns null when no question is found", () => {
    const screen = "just regular terminal output\n$ ls\nfile1.js file2.js";
    const result = parseScreenForQuestion(screen);
    assert.equal(result, null);
  });
});

describe("enrichNotification", () => {
  it("adds screen data and question info to waiting notifications", async () => {
    const notification = {
      id: "A",
      category: "waiting",
      workspaceId: "W1",
      surfaceId: "S1",
    };
    const workspaces = [{ id: "W1", title: "zenpayroll", directory: "/home/testuser/workspace/zenpayroll" }];
    const terminals = [{ workspaceId: "W1", paneId: "P1", directory: "/home/testuser/workspace/zenpayroll", gitBranch: "main" }];
    const mockReadScreen = async () => 'Some output\n  "Pick one?"\n  ❯ Option A\n    Option B';

    const result = await enrichNotification(notification, workspaces, terminals, mockReadScreen);
    assert.equal(result.workspaceTitle, "zenpayroll");
    assert.equal(result.workspaceDir, "/home/testuser/workspace/zenpayroll");
    assert.equal(result.gitBranch, "main");
    assert.ok(result.screenContent);
  });
});
