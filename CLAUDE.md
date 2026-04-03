# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Port-whisperer is a macOS CLI tool (`ports` / `whoisonport`) that shows what's running on your ports with framework detection and interactive process management. Pure JavaScript ES modules, no build step, no TypeScript.

## Commands

```bash
npm start                     # Run the CLI (node src/index.js)
node src/index.js             # Direct run
node src/index.js 3000        # Check specific port
node src/index.js ps          # List all dev processes
node src/index.js clean       # Find and kill orphaned processes
node src/index.js watch       # Real-time port monitoring
node src/index.js --all       # Show all ports (not just dev)
node src/index.js kill        # Interactive kill (multi-select from active ports)
node src/index.js kill 3000   # Kill process on port 3000 (no prompt)
node src/index.js kill 3000 5173  # Kill multiple ports
npm test                      # Run tests (vitest)
```

No linter or build step configured.

## Architecture

Three modules in `src/`, all ES modules:

- **`index.js`** — CLI entry point and command router. Parses args manually (no library). Uses `readline` for interactive kill prompts.
- **`scanner.js`** — Core engine. Runs `lsof`, `ps`, and `docker ps` as batched shell calls for performance (~0.2s). Exports: `getListeningPorts()`, `getAllProcesses()`, `getPortDetails()`, `findOrphanedProcesses()`, `killProcess()`, `watchPorts()`. Contains framework detection logic for 30+ frameworks and dev-process filtering heuristics.
- **`display.js`** — Rendering layer. Color-coded tables via `chalk` + `cli-table3` with framework-specific color schemes. Exports: `displayPortTable()`, `displayProcessTable()`, `displayPortDetail()`, `displayCleanResults()`, `displayWatchEvent()`.

Data flow: `index.js` calls `scanner.js` to collect data → passes results to `display.js` for rendering.

## Key Design Decisions

- **macOS only** — relies on `lsof -iTCP -sTCP:LISTEN` and macOS `ps` flags. Linux support planned but not implemented.
- **No argument parsing library** — commands and flags are parsed manually in `index.js`.
- **Batch system calls** — scanner runs `ps` and `lsof` once and filters in JS rather than making per-port calls.
- **Two npm bin aliases** — both `ports` and `whoisonport` point to the same entry point.
- **Only 3 runtime deps** — `chalk` for colors, `cli-table3` for table formatting, `@inquirer/prompts` for interactive selection.
