# `ports kill` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ports kill <port> [port...]` command that immediately kills processes on specified ports without interactive prompts, showing a brief summary before each kill.

**Architecture:** New `case "kill":` branch in the existing command switch in `src/index.js`. Reuses `getPortDetails()` and `killProcess()` from `scanner.js`. To make this testable, the kill logic is extracted into a standalone function `handleKill(ports)` that returns an exit code — the switch case just calls it and sets the process exit code.

**Tech Stack:** Node.js ES modules, chalk for output, vitest for tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.js` | Modify | Add `case "kill"` to switch, add `handleKill()` function, update help text |
| `test/kill.test.js` | Create | Tests for all kill command behaviors |
| `package.json` | Modify | Add vitest dev dependency, add `test` script |
| `README.md` | Modify | Add `ports kill` usage section |
| `CLAUDE.md` | Modify | Add `ports kill` to commands list |

---

### Task 1: Set Up Test Infrastructure

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

Run:
```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script to package.json**

Add to `"scripts"` in `package.json`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Verify vitest runs**

Run:
```bash
npm test
```

Expected: vitest runs and reports "no test files found" (or similar). Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for testing"
```

---

### Task 2: Write Failing Tests for Kill Command

**Files:**
- Create: `test/kill.test.js`

- [ ] **Step 1: Create test file with all test cases**

Create `test/kill.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock scanner.js before importing handleKill
vi.mock("../src/scanner.js", () => ({
  getPortDetails: vi.fn(),
  killProcess: vi.fn(),
}));

// Mock chalk to get plain text output for assertions
vi.mock("chalk", () => {
  const passthrough = (s) => s;
  const chain = new Proxy(passthrough, {
    get: () => chain,
    apply: (_, __, args) => args.join(""),
  });
  return { default: chain };
});

import { getPortDetails, killProcess } from "../src/scanner.js";
import { handleKill } from "../src/index.js";

describe("handleKill", () => {
  let output;

  beforeEach(() => {
    vi.clearAllMocks();
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      output.push(args.join(" ")),
    );
  });

  it("kills a single port successfully", async () => {
    getPortDetails.mockReturnValue({
      pid: 12345,
      port: 3000,
      processName: "node",
      framework: "Next.js",
      projectName: "my-app",
    });
    killProcess.mockReturnValue(true);

    const code = await handleKill([3000]);

    expect(getPortDetails).toHaveBeenCalledWith(3000);
    expect(killProcess).toHaveBeenCalledWith(12345);
    expect(code).toBe(0);
    expect(output.some((line) => line.includes("Killed"))).toBe(true);
  });

  it("returns 1 when port has no process", async () => {
    getPortDetails.mockReturnValue(null);

    const code = await handleKill([3000]);

    expect(code).toBe(1);
    expect(output.some((line) => line.includes("No process found"))).toBe(true);
  });

  it("returns 1 when kill fails", async () => {
    getPortDetails.mockReturnValue({
      pid: 12345,
      port: 3000,
      processName: "node",
      framework: null,
      projectName: null,
    });
    killProcess.mockReturnValue(false);

    const code = await handleKill([3000]);

    expect(code).toBe(1);
    expect(output.some((line) => line.includes("Failed"))).toBe(true);
    expect(output.some((line) => line.includes("sudo kill -9 12345"))).toBe(
      true,
    );
  });

  it("handles multiple ports with mixed results", async () => {
    getPortDetails
      .mockReturnValueOnce({
        pid: 111,
        port: 3000,
        processName: "node",
        framework: "Next.js",
        projectName: "app-a",
      })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        pid: 333,
        port: 8080,
        processName: "java",
        framework: "Java",
        projectName: "api",
      });
    killProcess.mockReturnValueOnce(true).mockReturnValueOnce(true);

    const code = await handleKill([3000, 5173, 8080]);

    expect(code).toBe(1); // one port not found
    expect(killProcess).toHaveBeenCalledTimes(2);
  });

  it("returns 1 and shows usage when no ports given", async () => {
    const code = await handleKill([]);

    expect(code).toBe(1);
    expect(output.some((line) => line.includes("Usage"))).toBe(true);
  });

  it("skips non-numeric arguments and returns 1", async () => {
    const code = await handleKill(["abc"]);

    expect(code).toBe(1);
    expect(output.some((line) => line.includes("not a valid port"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```

Expected: All 6 tests FAIL because `handleKill` is not exported from `src/index.js` yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add test/kill.test.js
git commit -m "test: add failing tests for ports kill command"
```

---

### Task 3: Implement `handleKill` and Wire Up the Command

**Files:**
- Modify: `src/index.js:1-11` (add export for handleKill)
- Modify: `src/index.js:72-233` (add kill case to switch, add handleKill function)

- [ ] **Step 1: Add `handleKill` function to `src/index.js`**

Add this function before `main()` (e.g. after line 26):

```javascript
/**
 * Kill processes on specified ports without interactive prompts.
 * Returns 0 if all succeeded, 1 if any failed.
 */
export async function handleKill(portArgs) {
  if (portArgs.length === 0) {
    console.log(chalk.red("\n  Usage: ports kill <port> [port...]\n"));
    return 1;
  }

  let anyFailed = false;
  console.log();

  for (const arg of portArgs) {
    const portNum = parseInt(arg, 10);
    if (isNaN(portNum)) {
      console.log(chalk.red(`  ✕ "${arg}" is not a valid port number`));
      anyFailed = true;
      continue;
    }

    const info = getPortDetails(portNum);
    if (!info) {
      console.log(chalk.red(`  ✕ No process found on :${portNum}`));
      anyFailed = true;
      continue;
    }

    const label = [
      info.framework,
      info.projectName,
    ].filter(Boolean).join(" — ");
    const detail = label ? ` [${label}]` : "";
    console.log(
      chalk.white(`  Killing ${info.processName} (PID ${info.pid}) on :${portNum}${detail}`),
    );

    const success = killProcess(info.pid);
    if (success) {
      console.log(chalk.green(`  ✓ Killed PID ${info.pid}`));
    } else {
      console.log(chalk.red(`  ✕ Failed to kill PID ${info.pid}. Try: sudo kill -9 ${info.pid}`));
      anyFailed = true;
    }
  }

  console.log();
  return anyFailed ? 1 : 0;
}
```

- [ ] **Step 2: Add `case "kill"` to the switch block**

In the `switch (command)` block in `main()`, add before the `case "help":` block:

```javascript
    case "kill": {
      const exitCode = await handleKill(filteredArgs.slice(1));
      process.exitCode = exitCode;
      break;
    }
```

- [ ] **Step 3: Update help text**

In the help `case`, add this line after the `ports ps` line:

```javascript
      console.log(
        `    ${chalk.cyan("ports kill <port>")}  Kill process on a port (no prompt)`,
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Manual smoke test**

Run:
```bash
node src/index.js kill
node src/index.js kill abc
node src/index.js help
```

Expected:
- `ports kill` → shows usage hint
- `ports kill abc` → shows "not a valid port number"
- `ports help` → includes the new `ports kill` line

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: add ports kill command for non-interactive port killing"
```

---

### Task 4: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `ports kill` section to README.md**

Insert after the "Inspect a specific port" section (after line 79) and before "Show all dev processes":

```markdown
### Kill a process on a port

```bash
ports kill 3000
```

Immediately kills whatever is listening on port 3000 — no confirmation prompt. Shows what it killed:

```
  Killing node (PID 42872) on :3000 [Next.js — frontend]
  ✓ Killed PID 42872
```

Kill multiple ports at once:

```bash
ports kill 3000 5173 8080
```
```

- [ ] **Step 2: Update CLAUDE.md commands**

Add to the commands section in `CLAUDE.md`, after the `node src/index.js --all` line:

```markdown
node src/index.js kill 3000   # Kill process on port 3000 (no prompt)
node src/index.js kill 3000 5173  # Kill multiple ports
```

Also add `npm test` to the commands:

```markdown
npm test                       # Run tests (vitest)
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add ports kill to README and CLAUDE.md"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

Run:
```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run linting/formatting check**

The project has no linter configured, but verify the code is consistent with existing style (2-space indent, ES modules, no trailing whitespace):

Run:
```bash
node src/index.js help
```

Expected: Help text looks clean, `ports kill` line is aligned with others.

- [ ] **Step 3: Verify git status is clean**

Run:
```bash
git status
git log --oneline -5
```

Expected: Working tree is clean, recent commits show:
1. `chore: add vitest for testing`
2. `test: add failing tests for ports kill command`
3. `feat: add ports kill command for non-interactive port killing`
4. `docs: add ports kill to README and CLAUDE.md`
