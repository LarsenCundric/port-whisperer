#!/usr/bin/env node

import {
  getListeningPorts,
  getPortDetails,
  findOrphanedProcesses,
  killProcess,
  watchPorts,
  isDevProcess,
  getAllProcesses,
  resolveKillTarget,
  getProcessLogFiles,
  getSystemLogCommand,
} from "./scanner.js";
import {
  displayPortTable,
  displayPortDetail,
  displayCleanResults,
  displayWatchEvent,
  displayWatchHeader,
  displayProcessTable,
} from "./display.js";
import chalk from "chalk";
import { createInterface } from "readline";
import { spawn } from "child_process";

function spawnTail(filePath, numLines, follow = true) {
  if (process.platform === "win32") {
    const waitFlag = follow ? " -Wait" : "";
    return spawn("powershell", [
      "-Command",
      `Get-Content -Path '${filePath}' -Tail ${numLines}${waitFlag}`,
    ], { stdio: "inherit" });
  }
  const args = follow ? ["-f", "-n", numLines, filePath] : ["-n", numLines, filePath];
  return spawn("tail", args, { stdio: "inherit" });
}

const args = process.argv.slice(2);
const showAll = args.includes("--all") || args.includes("-a");
const watchMode = args.includes("--watch") || args.includes("-w");
// Parse --interval=N or --interval N (seconds). Default 2s.
let watchIntervalSec = 2;
const intervalEq = args.find((a) => a.startsWith("--interval="));
if (intervalEq) {
  const v = parseFloat(intervalEq.split("=")[1]);
  if (!isNaN(v) && v > 0) watchIntervalSec = v;
} else {
  const idx = args.indexOf("--interval");
  if (idx !== -1 && args[idx + 1]) {
    const v = parseFloat(args[idx + 1]);
    if (!isNaN(v) && v > 0) watchIntervalSec = v;
  }
}
const filteredArgs = args.filter(
  (a, i, arr) =>
    a !== "--all" &&
    a !== "-a" &&
    a !== "--watch" &&
    a !== "-w" &&
    a !== "--interval" &&
    !a.startsWith("--interval=") &&
    !(i > 0 && (arr[i - 1] === "--interval")),
);
const command = filteredArgs[0];

function printWatchFooter() {
  const ts = new Date().toLocaleTimeString();
  console.log(
    chalk.gray(
      `  Watching · refresh every ${watchIntervalSec}s · last update ${ts} · Ctrl+C to stop`,
    ),
  );
  console.log();
}

// Capture everything written to stdout while fn runs, so we can flip the
// screen to the new frame atomically (no blank flash between clear and redraw).
async function captureStdout(fn) {
  const origWrite = process.stdout.write.bind(process.stdout);
  let buffer = "";
  process.stdout.write = function (chunk, encoding, cb) {
    buffer +=
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
          : String(chunk);
    const done = typeof encoding === "function" ? encoding : cb;
    if (typeof done === "function") done();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return { buffer, write: origWrite };
}

async function runWatched(renderOnce) {
  // Hide cursor during watch for a cleaner look.
  process.stdout.write("\x1b[?25l");
  const restoreCursor = () => process.stdout.write("\x1b[?25h");

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    restoreCursor();
    console.log(chalk.gray("\n  Stopped watching.\n"));
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let firstFrame = true;
  while (!stopped) {
    let frame;
    try {
      frame = await captureStdout(async () => {
        await renderOnce();
        printWatchFooter();
      });
    } catch (err) {
      frame = {
        buffer: chalk.red(`\n  Error: ${err.message}\n\n`),
        write: process.stdout.write.bind(process.stdout),
      };
    }
    // Atomic flip: first frame wipes scrollback for a clean canvas,
    // subsequent frames just home the cursor and let "clear to end of screen"
    // erase anything left over from a shorter frame. Also erase to end of
    // line at every newline so blank lines and shorter lines fully replace
    // the previous frame - otherwise \n only moves the cursor and leaves
    // stale trailing characters from the old frame visible.
    const prefix = firstFrame ? "\x1b[H\x1b[2J\x1b[3J" : "\x1b[H";
    const cleaned = frame.buffer.replace(/\n/g, "\x1b[K\n");
    frame.write(prefix + cleaned + "\x1b[0J");
    firstFrame = false;
    await new Promise((r) => setTimeout(r, watchIntervalSec * 1000));
  }
}

async function main() {
  // No args: show dev ports by default, --all for everything
  if (!command) {
    const renderPortList = async () => {
      let ports = await getListeningPorts();
      if (!showAll) {
        ports = ports.filter((p) => isDevProcess(p.processName, p.command));
      }
      displayPortTable(ports, !showAll);
    };

    if (watchMode) {
      await runWatched(renderPortList);
      return;
    }
    await renderPortList();
    return;
  }

  // Specific port number
  const portNum = parseInt(command, 10);
  if (!isNaN(portNum)) {
    if (watchMode) {
      await runWatched(async () => {
        const info = await getPortDetails(portNum);
        displayPortDetail(info);
      });
      return;
    }

    const info = await getPortDetails(portNum);
    displayPortDetail(info);

    if (info) {
      // Interactive kill prompt
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        chalk.yellow(`  Kill process on :${portNum}? [y/N] `),
        (answer) => {
          if (answer.toLowerCase() === "y") {
            const success = killProcess(info.pid);
            if (success) {
              console.log(chalk.green(`\n  ✓ Killed PID ${info.pid}\n`));
            } else {
              console.log(
                chalk.red(`\n  ✕ Failed. Try: sudo kill -9 ${info.pid}\n`),
              );
            }
          }
          rl.close();
        },
      );
    }
    return;
  }

  // Named commands
  switch (command) {
    case "ps": {
      const renderProcessList = async () => {
        let processes = await getAllProcesses();
        if (!showAll) {
          processes = processes.filter((p) =>
            isDevProcess(p.processName, p.command),
          );
          // Collapse Docker internal processes into one summary row
          const dockerProcs = processes.filter(
            (p) =>
              p.processName.startsWith("com.docke") ||
              p.processName.startsWith("Docker") ||
              p.processName === "docker" ||
              p.processName === "docker-sandbox",
          );
          const nonDocker = processes.filter(
            (p) =>
              !p.processName.startsWith("com.docke") &&
              !p.processName.startsWith("Docker") &&
              p.processName !== "docker" &&
              p.processName !== "docker-sandbox",
          );
          if (dockerProcs.length > 0) {
            const totalCpu = dockerProcs.reduce((s, p) => s + p.cpu, 0);
            const totalRssKB = dockerProcs.reduce((s, p) => {
              const m = (p.memory || "").match(/([\d.]+)\s*(GB|MB|KB)/);
              if (!m) return s;
              const val = parseFloat(m[1]);
              if (m[2] === "GB") return s + val * 1048576;
              if (m[2] === "MB") return s + val * 1024;
              return s + val;
            }, 0);
            const memStr =
              totalRssKB > 1048576
                ? `${(totalRssKB / 1048576).toFixed(1)} GB`
                : totalRssKB > 1024
                  ? `${(totalRssKB / 1024).toFixed(1)} MB`
                  : `${Math.round(totalRssKB)} KB`;
            nonDocker.push({
              pid: dockerProcs[0].pid,
              processName: "Docker",
              command: "",
              description: `${dockerProcs.length} processes`,
              cpu: totalCpu,
              memory: memStr,
              cwd: null,
              projectName: null,
              framework: "Docker",
              uptime: dockerProcs[0].uptime,
            });
          }
          processes = nonDocker;
        }
        processes.sort((a, b) => b.cpu - a.cpu);
        displayProcessTable(processes, !showAll);
      };

      if (watchMode) {
        await runWatched(renderProcessList);
        return;
      }
      await renderProcessList();
      break;
    }

    case "clean": {
      const orphaned = await findOrphanedProcesses();
      const killed = [];
      const failed = [];

      if (orphaned.length === 0) {
        displayCleanResults(orphaned, killed, failed);
        return;
      }

      // Confirm before killing
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log();
      console.log(
        chalk.yellow.bold(
          `  Found ${orphaned.length} orphaned/zombie process${orphaned.length === 1 ? "" : "es"}:`,
        ),
      );
      for (const p of orphaned) {
        console.log(
          `  ${chalk.gray("•")} :${chalk.white.bold(p.port)} — ${p.processName} ${chalk.gray(`(PID ${p.pid})`)}`,
        );
      }
      console.log();

      rl.question(chalk.yellow("  Kill all? [y/N] "), (answer) => {
        if (answer.toLowerCase() === "y") {
          for (const p of orphaned) {
            if (killProcess(p.pid)) {
              killed.push(p.pid);
            } else {
              failed.push(p.pid);
            }
          }
          displayCleanResults(orphaned, killed, failed);
        } else {
          console.log(chalk.gray("\n  Aborted.\n"));
        }
        rl.close();
      });
      break;
    }

    case "kill": {
      const rawKillArgs = filteredArgs
        .slice(1)
        .filter((a) => a !== "--force" && a !== "-f");
      const force =
        filteredArgs.includes("--force") || filteredArgs.includes("-f");
      const signal = force ? "SIGKILL" : "SIGTERM";

      if (rawKillArgs.length === 0) {
        console.log(
          chalk.red(
            `\n  Usage: ports kill [-f|--force] <port|pid|range> [port|pid|range...]\n`,
          ),
        );
        console.log(
          chalk.gray(
            "  Kills listener on port (1-65535), or process by PID. Use -f for SIGKILL.",
          ),
        );
        console.log(chalk.gray("  Ranges: ports kill 3000-3010\n"));
        process.exit(1);
      }

      // Expand port ranges (e.g. "3000-3010") into individual args
      const killArgs = [];
      const rangeSpans = []; // track which args came from ranges
      for (const arg of rawKillArgs) {
        const rangeMatch = arg.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (start > end) {
            console.log(
              chalk.red(
                `\n  ✕ Invalid range: ${arg} (start must be less than end)\n`,
              ),
            );
            process.exitCode = 1;
            return;
          }
          if (end - start > 1000) {
            console.log(
              chalk.red(`\n  ✕ Range too large: ${arg} (max 1000 ports)\n`),
            );
            process.exitCode = 1;
            return;
          }
          if (start < 1 || end > 65535) {
            console.log(
              chalk.red(
                `\n  ✕ Invalid range: ${arg} (ports must be 1-65535)\n`,
              ),
            );
            process.exitCode = 1;
            return;
          }
          const rangeStart = killArgs.length;
          for (let p = start; p <= end; p++) {
            killArgs.push(String(p));
          }
          rangeSpans.push({
            start: rangeStart,
            end: killArgs.length,
            label: arg,
          });
        } else {
          killArgs.push(arg);
        }
      }

      let anyFailed = false;
      let killed = 0;
      let noListener = 0;
      console.log();

      for (let i = 0; i < killArgs.length; i++) {
        const arg = killArgs[i];
        const n = parseInt(arg, 10);
        const isFromRange = rangeSpans.some((r) => i >= r.start && i < r.end);

        if (isNaN(n) || String(n) !== arg.trim()) {
          console.log(chalk.red(`  ✕ "${arg}" is not a valid port/PID`));
          anyFailed = true;
          continue;
        }

        const resolved = await resolveKillTarget(n);
        if (!resolved) {
          // Silently count misses from ranges instead of spamming
          if (isFromRange) {
            noListener++;
            continue;
          }
          const msg =
            n <= 65535
              ? `No listener on :${n} and no process with PID ${n}`
              : `No process with PID ${n}`;
          console.log(chalk.red(`  ✕ ${msg}`));
          anyFailed = true;
          continue;
        }

        const { pid, via } = resolved;
        const label =
          via === "port"
            ? `:${resolved.port} — ${resolved.info?.processName || "unknown"} (PID ${pid})`
            : `PID ${pid}`;

        console.log(chalk.white(`  Killing ${label}`));
        const ok = killProcess(pid, signal);
        if (ok) {
          console.log(chalk.green(`  ✓ Sent ${signal} to ${label}`));
          killed++;
        } else {
          console.log(
            chalk.red(`  ✕ Failed. Try: sudo kill${force ? " -9" : ""} ${pid}`),
          );
          anyFailed = true;
        }
      }

      // Print summary for ranges
      if (rangeSpans.length > 0) {
        const parts = [];
        if (killed > 0) parts.push(chalk.green(`${killed} killed`));
        if (noListener > 0) parts.push(chalk.gray(`${noListener} empty`));
        if (anyFailed) parts.push(chalk.red(`some failed`));
        console.log(
          `  ${chalk.dim("Range summary:")} ${parts.join(chalk.dim(", "))}`,
        );
      }

      console.log();
      process.exitCode = anyFailed ? 1 : 0;
      break;
    }

    case "logs": {
      const follow = filteredArgs.includes("-f") || filteredArgs.includes("--follow");
      const errOnly = filteredArgs.includes("--err");
      // Parse --lines=N or --lines N
      let lines = "50";
      const linesEqArg = filteredArgs.find((a) => a.startsWith("--lines="));
      if (linesEqArg) {
        lines = linesEqArg.split("=")[1];
      } else {
        const linesIdx = filteredArgs.indexOf("--lines");
        if (linesIdx !== -1 && filteredArgs[linesIdx + 1]) {
          lines = filteredArgs[linesIdx + 1];
        }
      }
      const logsArgs = filteredArgs
        .slice(1)
        .filter((a) => !a.startsWith("--") && a !== "-f" && a !== lines);

      if (logsArgs.length === 0) {
        console.log(
          chalk.red(
            `\n  Usage: ports logs <port|pid> [-f] [--lines=N] [--err]\n`,
          ),
        );
        console.log(chalk.gray("  Show log output for a process running on a port."));
        console.log(chalk.gray("  Use -f or --follow to stream new lines.\n"));
        process.exit(1);
      }

      const target = parseInt(logsArgs[0], 10);
      if (isNaN(target)) {
        console.log(chalk.red(`\n  ✕ "${logsArgs[0]}" is not a valid port/PID\n`));
        process.exit(1);
      }

      const resolved = await resolveKillTarget(target);
      if (!resolved) {
        const msg =
          target <= 65535
            ? `No listener on :${target} and no process with PID ${target}`
            : `No process with PID ${target}`;
        console.log(chalk.red(`\n  ✕ ${msg}\n`));
        process.exit(1);
      }

      const { pid, via } = resolved;
      const portLabel = via === "port" ? `:${resolved.port}` : `PID ${pid}`;
      const processName = resolved.info?.processName || "unknown";

      console.log();
      console.log(
        chalk.cyan.bold("  Port Whisperer") +
          chalk.gray(` — logs for ${portLabel} (${processName}, PID ${pid})`),
      );
      console.log();

      const logFiles = getProcessLogFiles(pid);

      if (errOnly) {
        const stderrFile = logFiles.find((f) => f.fd === "stderr");
        if (stderrFile) {
          console.log(
            `  ${chalk.yellow("▸")} Tailing stderr: ${chalk.dim(stderrFile.path)}\n`,
          );
          const tail = spawnTail(stderrFile.path, lines, follow);
          if (follow) {
            process.on("SIGINT", () => { tail.kill(); process.exit(0); });
            await new Promise(() => {});
          } else {
            await new Promise((resolve) => tail.on("close", resolve));
          }
          break;
        }
        console.log(chalk.yellow(`  No stderr redirect found for PID ${pid}\n`));
        break;
      }

      if (logFiles.length > 0) {
        if (logFiles.length === 1) {
          const f = logFiles[0];
          const label = f.fd === "stdout" ? "stdout" : f.fd === "stderr" ? "stderr" : "log";
          console.log(
            `  ${chalk.green("▸")} Tailing ${label}: ${chalk.dim(f.path)}\n`,
          );
          const tail = spawnTail(f.path, lines, follow);
          if (follow) {
            process.on("SIGINT", () => { tail.kill(); process.exit(0); });
            await new Promise(() => {});
          } else {
            await new Promise((resolve) => tail.on("close", resolve));
          }
          break;
        }

        // Multiple log files — let user pick
        console.log(chalk.bold("  Found log files:\n"));
        logFiles.forEach((f, i) => {
          const label =
            f.fd === "stdout" ? chalk.green("stdout") :
            f.fd === "stderr" ? chalk.yellow("stderr") :
            chalk.dim(f.type);
          console.log(`    ${chalk.white.bold(i + 1)}  ${label}  ${chalk.dim(f.path)}`);
        });
        console.log();

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise((resolve) => {
          rl.question(chalk.yellow(`  Pick a file (1-${logFiles.length}): `), resolve);
        });
        rl.close();

        const idx = parseInt(answer, 10) - 1;
        if (idx < 0 || idx >= logFiles.length) {
          console.log(chalk.red("\n  Invalid selection.\n"));
          break;
        }

        const selected = logFiles[idx];
        console.log(
          `\n  ${chalk.green("▸")} Tailing: ${chalk.dim(selected.path)}\n`,
        );
        const tail = spawnTail(selected.path, lines, follow);
        if (follow) {
          process.on("SIGINT", () => { tail.kill(); process.exit(0); });
          await new Promise(() => {});
        } else {
          await new Promise((resolve) => tail.on("close", resolve));
        }
      }

      // No log files — try system log
      const sysCmd = getSystemLogCommand(pid, follow);
      if (sysCmd) {
        console.log(
          chalk.yellow(`  No log files found. Falling back to system log...\n`),
        );
        console.log(`  ${chalk.dim(`$ ${sysCmd}`)}\n`);
        const [cmd, ...sysArgs] = sysCmd.split(" ");
        const proc = spawn(cmd, sysArgs, { stdio: "inherit" });
        if (follow) {
          process.on("SIGINT", () => { proc.kill(); process.exit(0); });
          await new Promise(() => {});
        } else {
          await new Promise((resolve) => proc.on("close", resolve));
        }
      }

      console.log(
        chalk.yellow(`  No log files or system log found for PID ${pid}.\n`),
      );
      console.log(
        chalk.dim(
          `  Tip: if the process logs to the terminal, check the terminal where it was started.\n`,
        ),
      );
      break;
    }

    case "watch": {
      displayWatchHeader();
      const interval = watchPorts((type, info) => {
        displayWatchEvent(type, info);
      }, 2000);

      // Handle graceful exit
      process.on("SIGINT", () => {
        clearInterval(interval);
        console.log(chalk.gray("\n\n  Stopped watching.\n"));
        process.exit(0);
      });
      break;
    }

    case "help":
    case "--help":
    case "-h": {
      console.log();
      console.log(
        chalk.cyan.bold("  Port Whisperer") +
          chalk.gray(" — listen to your ports"),
      );
      console.log();
      console.log(chalk.white("  Usage:"));
      console.log(
        `    ${chalk.cyan("ports")}              Show dev server ports`,
      );
      console.log(
        `    ${chalk.cyan("ports --all")}        Show all listening ports`,
      );
      console.log(
        `    ${chalk.cyan("ports ps")}           Show all running dev processes`,
      );
      console.log(
        `    ${chalk.cyan("ports <number>")}     Detailed info about a specific port`,
      );
      console.log(
        `    ${chalk.cyan("ports kill <n>")}     Kill by port, PID, or range (-f for SIGKILL)`,
      );
      console.log(
        `    ${chalk.cyan("ports kill 3000-3010")} Kill all listeners in a port range`,
      );
      console.log(
        `    ${chalk.cyan("ports logs <n>")}     Tail log output for a process on a port`,
      );
      console.log(
        `    ${chalk.cyan("ports clean")}        Kill orphaned/zombie dev servers`,
      );
      console.log(
        `    ${chalk.cyan("ports watch")}        Monitor port changes in real-time`,
      );
      console.log(
        `    ${chalk.cyan("ports --watch")}      Auto-refresh the port list (2s by default)`,
      );
      console.log(
        `    ${chalk.cyan("ports ps --watch")}   Auto-refresh the process list`,
      );
      console.log(
        `    ${chalk.cyan("whoisonport <num>")} Alias for ports <number>`,
      );
      console.log();
      console.log(chalk.white("  Flags:"));
      console.log(
        `    ${chalk.cyan("--watch, -w")}         Re-render every ${chalk.dim("--interval")} seconds until Ctrl+C`,
      );
      console.log(
        `    ${chalk.cyan("--interval <sec>")}    Refresh interval for ${chalk.dim("--watch")} (default: 2)`,
      );
      console.log();
      break;
    }

    default:
      console.log(chalk.red(`\n  Unknown command: ${command}`));
      console.log(
        chalk.gray(`  Run ${chalk.cyan("ports --help")} for usage.\n`),
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n  Error: ${err.message}\n`));
  process.exit(1);
});
