import chalk from "chalk";
import Table from "cli-table3";
import stringWidth from "string-width";

const ICONS = {
  healthy: chalk.green("●"),
  orphaned: chalk.yellow("●"),
  zombie: chalk.red("●"),
  unknown: chalk.gray("●"),
  port: chalk.cyan("⌘"),
  folder: chalk.blue("📂"),
  git: chalk.magenta("⎇"),
  time: chalk.yellow("⏱"),
  memory: chalk.green("◆"),
  process: chalk.white("⚙"),
  kill: chalk.red("✕"),
  watch: chalk.cyan("👁"),
};

const FRAMEWORK_COLORS = {
  "Next.js": chalk.white.bgBlack,
  Vite: chalk.yellow,
  React: chalk.cyan,
  Vue: chalk.green,
  Angular: chalk.red,
  Svelte: chalk.rgb(255, 62, 0),
  SvelteKit: chalk.rgb(255, 62, 0),
  Express: chalk.gray,
  Fastify: chalk.white,
  NestJS: chalk.red,
  Nuxt: chalk.green,
  Remix: chalk.blue,
  Astro: chalk.magenta,
  Django: chalk.green,
  Flask: chalk.white,
  FastAPI: chalk.cyan,
  Rails: chalk.red,
  Gatsby: chalk.magenta,
  Go: chalk.cyan,
  Rust: chalk.rgb(222, 165, 93),
  Ruby: chalk.red,
  Python: chalk.yellow,
  "Node.js": chalk.green,
  Java: chalk.red,
  Hono: chalk.rgb(255, 102, 0),
  Koa: chalk.white,
  Webpack: chalk.blue,
  esbuild: chalk.yellow,
  Parcel: chalk.rgb(224, 178, 77),
  Docker: chalk.blue,
  PostgreSQL: chalk.blue,
  Redis: chalk.red,
  MySQL: chalk.blue,
  MongoDB: chalk.green,
  nginx: chalk.green,
  LocalStack: chalk.white,
  RabbitMQ: chalk.rgb(255, 102, 0),
  Kafka: chalk.white,
  Elasticsearch: chalk.yellow,
  MinIO: chalk.red,
};

/**
 * Render the header banner
 */
const BOX_INNER_WIDTH = 37;

function padToWidth(text, targetWidth) {
  const actual = stringWidth(text);
  return text + " ".repeat(Math.max(0, targetWidth - actual));
}

function renderHeader() {
  const line1 = "  🔊 Port Whisperer";
  const line2 = "  listening to your ports...";
  const border = "─".repeat(BOX_INNER_WIDTH);
  console.log();
  console.log(chalk.cyan.bold(` ┌${border}┐`));
  console.log(
    chalk.cyan.bold(" │") +
      chalk.white.bold(padToWidth(line1, BOX_INNER_WIDTH)) +
      chalk.cyan.bold("│"),
  );
  console.log(
    chalk.cyan.bold(" │") +
      chalk.gray(padToWidth(line2, BOX_INNER_WIDTH)) +
      chalk.cyan.bold("│"),
  );
  console.log(chalk.cyan.bold(` └${border}┘`));
  console.log();
}

/**
 * Format framework name with color
 */
function formatFramework(framework) {
  if (!framework) return chalk.gray("—");
  const colorFn = FRAMEWORK_COLORS[framework] || chalk.white;
  return colorFn(framework);
}

/**
 * Format status with icon and label
 */
function formatStatus(status) {
  const icon = ICONS[status] || ICONS.unknown;
  const labels = {
    healthy: chalk.green("healthy"),
    orphaned: chalk.yellow("orphaned"),
    zombie: chalk.red("zombie"),
    unknown: chalk.gray("unknown"),
  };
  return `${icon} ${labels[status] || labels.unknown}`;
}

/**
 * Display all ports in a beautiful table
 */
export function displayPortTable(ports, filtered = false) {
  renderHeader();

  if (ports.length === 0) {
    console.log(chalk.gray("  No active listening ports found.\n"));
    console.log(
      chalk.gray("  Start a dev server and run ") +
        chalk.cyan("ports") +
        chalk.gray(" again.\n"),
    );
    return;
  }

  const table = new Table({
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    style: {
      head: [],
      border: ["gray"],
      "padding-left": 1,
      "padding-right": 1,
    },
    head: [
      chalk.cyan.bold("PORT"),
      chalk.cyan.bold("PROCESS"),
      chalk.cyan.bold("PID"),
      chalk.cyan.bold("PROJECT"),
      chalk.cyan.bold("FRAMEWORK"),
      chalk.cyan.bold("UPTIME"),
      chalk.cyan.bold("STATUS"),
    ],
  });

  for (const p of ports) {
    table.push([
      chalk.white.bold(`:${p.port}`),
      chalk.white(p.processName || p.rawName || "—"),
      chalk.gray(String(p.pid)),
      p.projectName ? chalk.blue(truncate(p.projectName, 20)) : chalk.gray("—"),
      formatFramework(p.framework),
      p.uptime ? chalk.yellow(p.uptime) : chalk.gray("—"),
      formatStatus(p.status),
    ]);
  }

  console.log(table.toString());
  console.log();
  const allHint = filtered
    ? chalk.gray("  ·  ") +
      chalk.cyan("--all") +
      chalk.gray(" to show everything")
    : "";
  console.log(
    chalk.gray(
      `  ${ports.length} port${ports.length === 1 ? "" : "s"} active  ·  `,
    ) +
      chalk.gray("Run ") +
      chalk.cyan("ports <number>") +
      chalk.gray(" for details") +
      allHint,
  );
  console.log();
}

/**
 * Display all processes in a table (ports ps)
 */
export function displayProcessTable(processes, filtered = false) {
  renderHeader();

  if (processes.length === 0) {
    console.log(chalk.gray("  No dev processes found.\n"));
    console.log(
      chalk.gray("  Run ") +
        chalk.cyan("ports ps --all") +
        chalk.gray(" to show all processes.\n"),
    );
    return;
  }

  const table = new Table({
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    style: {
      head: [],
      border: ["gray"],
      "padding-left": 1,
      "padding-right": 1,
    },
    head: [
      chalk.cyan.bold("PID"),
      chalk.cyan.bold("PROCESS"),
      chalk.cyan.bold("CPU%"),
      chalk.cyan.bold("MEM"),
      chalk.cyan.bold("PROJECT"),
      chalk.cyan.bold("FRAMEWORK"),
      chalk.cyan.bold("UPTIME"),
      chalk.cyan.bold("WHAT"),
    ],
  });

  for (const p of processes) {
    const cpuStr = p.cpu.toFixed(1);
    let cpuColored;
    if (p.cpu > 25) cpuColored = chalk.red(cpuStr);
    else if (p.cpu > 5) cpuColored = chalk.yellow(cpuStr);
    else cpuColored = chalk.green(cpuStr);

    table.push([
      chalk.gray(String(p.pid)),
      chalk.white.bold(truncate(p.processName, 15)),
      cpuColored,
      p.memory ? chalk.green(p.memory) : chalk.gray("—"),
      p.projectName
        ? chalk.blue(truncate(p.projectName, 20))
        : chalk.gray("—"),
      formatFramework(p.framework),
      p.uptime ? chalk.yellow(p.uptime) : chalk.gray("—"),
      chalk.gray(truncate(p.description || p.processName, 30)),
    ]);
  }

  console.log(table.toString());
  console.log();
  const allHint = filtered
    ? chalk.gray("  ·  ") +
      chalk.cyan("--all") +
      chalk.gray(" to show everything")
    : "";
  console.log(
    chalk.gray(
      `  ${processes.length} process${processes.length === 1 ? "" : "es"}`,
    ) + allHint,
  );
  console.log();
}

/**
 * Display detailed info for a single port
 */
export function displayPortDetail(info) {
  renderHeader();

  if (!info) {
    console.log(chalk.red("  No process found on that port.\n"));
    return;
  }

  const box = (label, value) => {
    console.log(`  ${chalk.gray(label.padEnd(16))} ${value}`);
  };

  console.log(chalk.white.bold(`  Port :${info.port}`));
  console.log(chalk.gray("  ─".repeat(22)));
  console.log();

  box("Process", chalk.white.bold(info.processName || info.rawName || "—"));
  box("PID", chalk.gray(String(info.pid)));
  box("Status", formatStatus(info.status));
  box("Framework", formatFramework(info.framework));
  box("Memory", info.memory ? chalk.green(info.memory) : chalk.gray("—"));
  box("Uptime", info.uptime ? chalk.yellow(info.uptime) : chalk.gray("—"));
  if (info.startTime) {
    box("Started", chalk.gray(info.startTime.toLocaleString()));
  }

  console.log();
  console.log(chalk.cyan.bold("  Location"));
  console.log(chalk.gray("  ─".repeat(22)));
  box("Directory", info.cwd ? chalk.blue(info.cwd) : chalk.gray("—"));
  box(
    "Project",
    info.projectName ? chalk.white(info.projectName) : chalk.gray("—"),
  );
  box(
    "Git Branch",
    info.gitBranch ? chalk.magenta(info.gitBranch) : chalk.gray("—"),
  );

  if (info.processTree && info.processTree.length > 0) {
    console.log();
    console.log(chalk.cyan.bold("  Process Tree"));
    console.log(chalk.gray("  ─".repeat(22)));
    for (let i = 0; i < info.processTree.length; i++) {
      const node = info.processTree[i];
      const indent = "  ".repeat(i);
      const prefix = i === 0 ? "→" : "└─";
      const pidColor = node.pid === info.pid ? chalk.white.bold : chalk.gray;
      console.log(
        `  ${indent}${chalk.gray(prefix)} ${pidColor(node.name)} ${chalk.gray(`(${node.pid})`)}`,
      );
    }
  }

  console.log();
  console.log(
    chalk.gray("  Kill this process: ") +
      chalk.cyan(`ports clean`) +
      chalk.gray(" or ") +
      chalk.red(`kill ${info.pid}`),
  );
  console.log();
}

/**
 * Display orphaned/zombie process cleanup results
 */
export function displayCleanResults(orphaned, killed, failed) {
  renderHeader();

  if (orphaned.length === 0) {
    console.log(
      chalk.green("  ✓ No orphaned or zombie processes found. All clean!\n"),
    );
    return;
  }

  console.log(
    chalk.yellow.bold(
      `  Found ${orphaned.length} orphaned/zombie process${orphaned.length === 1 ? "" : "es"}:\n`,
    ),
  );

  for (const p of orphaned) {
    const wasKilled = killed.includes(p.pid);
    const didFail = failed.includes(p.pid);
    const icon = wasKilled
      ? chalk.green("✓")
      : didFail
        ? chalk.red("✕")
        : chalk.yellow("?");
    console.log(
      `  ${icon} :${chalk.white.bold(p.port)} ${chalk.gray("—")} ${p.processName} ${chalk.gray(`(PID ${p.pid})`)}`,
    );
    if (didFail) {
      console.log(chalk.red(`    Failed to kill. Try: sudo kill -9 ${p.pid}`));
    }
  }

  console.log();
  if (killed.length > 0) {
    console.log(
      chalk.green(
        `  Cleaned ${killed.length} process${killed.length === 1 ? "" : "es"}.`,
      ),
    );
  }
  if (failed.length > 0) {
    console.log(
      chalk.red(
        `  Failed to clean ${failed.length} process${failed.length === 1 ? "" : "es"}.`,
      ),
    );
  }
  console.log();
}

/**
 * Display watch mode events
 */
export function displayWatchEvent(type, info) {
  const timestamp = chalk.gray(new Date().toLocaleTimeString());

  if (type === "new") {
    const fw = info.framework ? ` ${formatFramework(info.framework)}` : "";
    const proj = info.projectName ? chalk.blue(` [${info.projectName}]`) : "";
    console.log(
      `  ${timestamp} ${chalk.green("▲ NEW")}    :${chalk.white.bold(info.port)} ← ${chalk.white(info.processName)}${proj}${fw}`,
    );
  } else if (type === "removed") {
    console.log(
      `  ${timestamp} ${chalk.red("▼ CLOSED")} :${chalk.white.bold(info.port)}`,
    );
  }
}

/**
 * Display watch mode header
 */
export function displayWatchHeader() {
  renderHeader();
  console.log(chalk.cyan.bold("  Watching for port changes..."));
  console.log(chalk.gray("  Press Ctrl+C to stop\n"));
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
