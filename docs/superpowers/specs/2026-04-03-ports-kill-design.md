# `ports kill` — Non-Interactive Port Killing

## Summary

Add a `ports kill <port> [port...]` command that immediately kills processes on specified ports without interactive prompts. Shows a brief summary of what's being killed before doing it.

## Command Syntax

```
ports kill <port> [port...]
```

Examples:
- `ports kill 3000`
- `ports kill 3000 5173 8080`

## Behavior

For each port argument, in sequence:

1. Call `getPortDetails(port)` to look up what's listening
2. **Nothing found** → print `No process found on :PORT`, continue to next port, track as failure
3. **Found** → print one-line summary then kill:
   ```
   Killing node (PID 12345) on :3000 [Next.js — my-app]
   ✓ Killed PID 12345
   ```
4. **Kill fails** → print:
   ```
   ✕ Failed to kill PID 12345. Try: sudo kill -9 12345
   ```

### Exit Codes

- `0` — all ports killed successfully
- `1` — any port had no process or kill failed

### Edge Cases

- `ports kill` with no port numbers → print usage hint (`Usage: ports kill <port> [port...]`), exit 1
- Non-numeric arguments → print error for that argument, continue to next
- Multiple ports where some fail → report each individually, exit 1 at end

## Code Changes

### `src/index.js`

- Add `case "kill":` to the switch block (after `case "ps":`)
- Parse `filteredArgs.slice(1)` as port numbers
- Loop over each port: call `getPortDetails()` + `killProcess()` from scanner.js
- Output formatted with chalk (inline, no new display function needed)
- Add `ports kill <port>` line to the help text

### `src/scanner.js`

No changes. `getPortDetails()` and `killProcess()` already exist and cover this use case.

### `src/display.js`

No changes. Output is simple enough to handle inline in index.js.

## Tests

New test infrastructure (no tests exist today):

- Install `vitest` as a dev dependency
- Add `test` script to package.json
- Create `test/kill.test.js`

### Test Cases

1. **Single port kill success** — mock `getPortDetails` returning a process, mock `killProcess` returning true → verify success output and exit code 0
2. **Port not found** — mock `getPortDetails` returning null → verify "No process found" message and exit code 1
3. **Kill failure** — mock `killProcess` returning false → verify failure message and exit code 1
4. **Multiple ports, mixed results** — some found/killed, some not found → verify each reported correctly, exit code 1
5. **No arguments** — no ports given → verify usage hint and exit code 1
6. **Non-numeric argument** — e.g. `ports kill abc` → verify error message, exit code 1

## Documentation

- Update `README.md` — add `ports kill` to the usage section
- Update `CLAUDE.md` — add `ports kill` to commands
- Update help text in `index.js`
