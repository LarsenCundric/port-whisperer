# Interactive Port Kill Selection

## Summary

When `ports kill` is run with no port arguments, show an interactive multi-select checkbox prompt listing all active dev ports. The user navigates with arrow keys, toggles ports with space, and confirms with enter. Selected ports are killed using the existing `handleKill()` function.

When `ports kill <port> [port...]` is run with arguments, behavior is unchanged — direct non-interactive kill.

## Command Syntax

```
ports kill              # Interactive mode — multi-select from active dev ports
ports kill 3000         # Direct mode — kill port 3000 (unchanged)
ports kill 3000 5173    # Direct mode — kill multiple ports (unchanged)
```

## Interactive Mode Behavior

1. Scan for dev ports: `getListeningPorts()` filtered by `isDevProcess()`
2. If no ports found → print "No active dev ports found." and exit 0
3. Show `@inquirer/prompts` checkbox prompt with choices like:
   ```
   ? Select ports to kill:
   ◯ :3000 — node [Next.js — frontend]
   ◯ :5173 — node [Vite — dashboard]
   ◯ :5432 — docker [PostgreSQL — backend-postgres-1]
   ```
4. User selects with space, confirms with enter
5. If user selects nothing or presses Ctrl+C → exit cleanly (exit 0)
6. Pass selected port numbers to `handleKill()` — existing kill logic handles the rest

## Dependencies

- Add `@inquirer/prompts` as a production dependency (only the `checkbox` function is used)

## Code Changes

### `src/index.js`

- Add `interactiveKill()` function:
  - Calls `getListeningPorts()` and filters with `isDevProcess()`
  - If empty → print message, return 0
  - Builds choices array: `{ name: ":3000 — node [Next.js — frontend]", value: 3000 }`
  - Calls `checkbox()` from `@inquirer/prompts`
  - If no ports selected → return 0
  - Calls `handleKill(selectedPorts)` and returns its exit code
- Modify `case "kill"` block:
  - If `filteredArgs.slice(1).length === 0` → call `interactiveKill()`
  - Otherwise → call `handleKill(args)` as before
- `handleKill()` is unchanged — it still handles the actual killing logic
- Update help text: `ports kill [port]   Kill ports (interactive if no port given)`

### `src/scanner.js`

No changes.

### `src/display.js`

No changes.

## Edge Cases

- No dev ports active → "No active dev ports found.", exit 0
- User presses Ctrl+C during selection → inquirer throws, catch it and exit 0 cleanly
- User selects nothing and presses enter → empty array, exit 0
- `--all` flag with `ports kill` interactive mode → not supported initially; only dev ports shown

## Tests

### New test cases in `test/kill.test.js`

1. **Interactive mode: selects and kills ports** — mock `getListeningPorts`, `isDevProcess`, and `checkbox` returning selected ports → verify `handleKill` is called with selected ports
2. **Interactive mode: no active ports** — mock `getListeningPorts` returning empty → verify message printed, checkbox not called
3. **Interactive mode: user selects nothing** — mock `checkbox` returning `[]` → verify no kills, exit 0
4. **Interactive mode: user cancels (Ctrl+C)** — mock `checkbox` throwing → verify clean exit 0

### Existing tests

All 6 existing `handleKill` tests remain unchanged.

## Documentation

- Update help text in `src/index.js`
- Update `README.md` — add interactive mode example to the kill section
- Update `CLAUDE.md` — add `ports kill` interactive mode to commands
