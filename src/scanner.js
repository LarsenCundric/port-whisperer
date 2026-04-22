import { execSync, execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { getPlatform } from "./platform/index.js";

/**
 * Batch-fetch docker container info mapped by host port.
 * Docker CLI is cross-platform.
 */
function batchDockerInfo() {
  const map = new Map();
  try {
    const raw = execSync(
      'docker ps --format "{{.Ports}}\\t{{.Names}}\\t{{.Image}}" 2>/dev/null',
      { encoding: "utf8", timeout: 5000 },
    ).trim();

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [portsStr, name, image] = line.split("\t");
      if (!portsStr || !name) continue;

      // Match both IPv4 (1.2.3.4:5432->) and IPv6 ([::]:5432-> or ::: form) bindings.
      // Docker typically emits IPv6 as `[::]:5432->5432/tcp`, but bare `:::5432->` also appears.
      const portMatches = portsStr.matchAll(
        /(?:\d+\.\d+\.\d+\.\d+|\[::\]|::):(\d+)->/g,
      );
      const seen = new Set();
      for (const m of portMatches) {
        const port = parseInt(m[1], 10);
        if (!seen.has(port)) {
          seen.add(port);
          map.set(port, { name, image });
        }
      }
    }
  } catch {}
  return map;
}

/**
 * Get all listening ports with enriched process info.
 */
export async function getListeningPorts(detailed = false) {
  const platform = await getPlatform();
  const entries = platform.getListeningPortsRaw();

  const uniquePids = [...new Set(entries.map((e) => e.pid))];

  const psMap = platform.batchProcessInfo(uniquePids);
  const cwdMap = platform.batchCwd(uniquePids);
  const hasDocker = entries.some(
    (e) => e.processName.startsWith("com.docke") || e.processName === "docker",
  );
  const dockerMap = hasDocker ? batchDockerInfo() : new Map();

  const results = entries.map(({ port, pid, processName }) => {
    const ps = psMap.get(pid);
    const cwd = cwdMap.get(pid);

    const info = {
      port,
      pid,
      processName,
      rawName: processName,
      command: ps ? ps.command : "",
      cwd: null,
      projectName: null,
      framework: null,
      uptime: null,
      startTime: null,
      status: "healthy",
      memory: null,
      gitBranch: null,
      processTree: [],
    };

    if (ps) {
      if (ps.stat.includes("Z")) info.status = "zombie";
      else if (ps.ppid === 1 && isDevProcess(processName, ps.command))
        info.status = "orphaned";

      if (ps.rss > 0) info.memory = formatMemory(ps.rss);

      if (ps.lstart) {
        info.startTime = new Date(ps.lstart);
        if (!isNaN(info.startTime.getTime())) {
          info.uptime = formatUptime(Date.now() - info.startTime.getTime());
        }
      }

      if (!info.framework) {
        info.framework = detectFrameworkFromCommand(ps.command, processName);
      }
    }

    const docker = dockerMap.get(port);
    if (docker) {
      info.projectName = docker.name;
      info.framework = detectFrameworkFromImage(docker.image);
      info.processName = "docker";
    }

    if (cwd && !docker) {
      const projectRoot = findProjectRoot(cwd);
      info.cwd = projectRoot;
      info.projectName = basename(projectRoot);
      info.framework = info.framework || detectFramework(projectRoot);

      if (detailed) {
        try {
          // execFileSync avoids the shell, so a crafted cwd (e.g. a directory
          // named `foo"; rm -rf ~ #`) cannot break out of the argument list.
          info.gitBranch = execFileSync(
            "git",
            ["-C", info.cwd, "rev-parse", "--abbrev-ref", "HEAD"],
            {
              encoding: "utf8",
              timeout: 3000,
              stdio: ["ignore", "pipe", "ignore"],
            },
          ).trim();
        } catch {}
      }
    }

    if (detailed) {
      info.processTree = platform.getProcessTree(pid);
    }

    return info;
  });

  return results.sort((a, b) => a.port - b.port);
}

/**
 * Check if a process looks like a dev server vs a regular system/desktop app.
 */
export function isDevProcess(processName, command) {
  const name = (processName || "").toLowerCase();
  const cmd = (command || "").toLowerCase();

  // System/desktop apps per platform
  const systemApps = [
    // macOS
    "spotify",
    "raycast",
    "tableplus",
    "postman",
    "linear",
    "cursor",
    "controlce",
    "rapportd",
    "superhuma",
    "setappage",
    "slack",
    "discord",
    "firefox",
    "chrome",
    "google",
    "safari",
    "figma",
    "notion",
    "zoom",
    "teams",
    "code",
    "iterm2",
    "warp",
    "arc",
    "loginwindow",
    "windowserver",
    "systemuise",
    "kernel_task",
    "launchd",
    "mdworker",
    "mds_stores",
    "cfprefsd",
    "coreaudio",
    "corebrightne",
    "airportd",
    "bluetoothd",
    "sharingd",
    "usernoted",
    "notificationc",
    "cloudd",
    // Linux
    "systemd",
    "snapd",
    "networkmanager",
    "gdm",
    "sshd",
    "cron",
    "dbus-daemon",
    "polkitd",
    "rsyslogd",
    "thermald",
    "accounts-daemon",
    // Windows
    "svchost",
    "csrss",
    "lsass",
    "services",
    "explorer",
    "dwm",
    "searchindexer",
    "taskhostw",
    "runtimebroker",
    "shellexperiencehost",
  ];
  for (const app of systemApps) {
    if (name.toLowerCase().startsWith(app)) return false;
  }

  // Dev process names (exact match on basename)
  const devNames = new Set([
    "node",
    "python",
    "python3",
    "ruby",
    "java",
    "go",
    "cargo",
    "deno",
    "bun",
    "php",
    "uvicorn",
    "gunicorn",
    "flask",
    "rails",
    "npm",
    "npx",
    "yarn",
    "pnpm",
    "tsc",
    "tsx",
    "esbuild",
    "rollup",
    "turbo",
    "nx",
    "jest",
    "vitest",
    "mocha",
    "pytest",
    "cypress",
    "playwright",
    "rustc",
    "dotnet",
    "gradle",
    "mvn",
    "mix",
    "elixir",
  ]);
  if (devNames.has(name)) return true;

  // Docker processes (prefix match)
  if (
    name.startsWith("com.docke") ||
    name === "docker" ||
    name === "docker-sandbox"
  )
    return true;

  // Command-line keyword matching (whole words only)
  const cmdIndicators = [
    /\bnode\b/,
    /\bnext[\s-]/,
    /\bvite\b/,
    /\bnuxt\b/,
    /\bwebpack\b/,
    /\bremix\b/,
    /\bastro\b/,
    /\bgulp\b/,
    /\bng serve\b/,
    /\bgatsb/,
    /\bflask\b/,
    /\bdjango\b|manage\.py/,
    /\buvicorn\b/,
    /\brails\b/,
    /\bcargo\b/,
  ];
  for (const re of cmdIndicators) {
    if (re.test(cmd)) return true;
  }

  return false;
}

/**
 * Get detailed info for a specific port.
 */
export async function getPortDetails(targetPort) {
  const ports = await getListeningPorts(true);
  return ports.find((p) => p.port === targetPort) || null;
}

function detectFrameworkFromImage(image) {
  if (!image) return "Docker";
  const img = image.toLowerCase();
  if (img.includes("postgres")) return "PostgreSQL";
  if (img.includes("redis")) return "Redis";
  if (img.includes("mysql") || img.includes("mariadb")) return "MySQL";
  if (img.includes("mongo")) return "MongoDB";
  if (img.includes("nginx")) return "nginx";
  if (img.includes("localstack")) return "LocalStack";
  if (img.includes("rabbitmq")) return "RabbitMQ";
  if (img.includes("kafka")) return "Kafka";
  if (img.includes("elasticsearch") || img.includes("opensearch"))
    return "Elasticsearch";
  if (img.includes("minio")) return "MinIO";
  return "Docker";
}

function findProjectRoot(dir) {
  const markers = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "Gemfile",
    "pom.xml",
    "build.gradle",
  ];
  let current = dir;
  let depth = 0;
  while (current !== "/" && current !== dirname(current) && depth < 15) {
    for (const marker of markers) {
      if (existsSync(join(current, marker))) return current;
    }
    current = dirname(current);
    depth++;
  }
  return dir;
}

function detectFramework(projectRoot) {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps["next"]) return "Next.js";
      if (allDeps["nuxt"] || allDeps["nuxt3"]) return "Nuxt";
      if (allDeps["@sveltejs/kit"]) return "SvelteKit";
      if (allDeps["svelte"]) return "Svelte";
      if (allDeps["@remix-run/react"] || allDeps["remix"]) return "Remix";
      if (allDeps["astro"]) return "Astro";
      if (allDeps["vite"]) return "Vite";
      if (allDeps["@angular/core"]) return "Angular";
      if (allDeps["vue"]) return "Vue";
      if (allDeps["react"]) return "React";
      if (allDeps["express"]) return "Express";
      if (allDeps["fastify"]) return "Fastify";
      if (allDeps["hono"]) return "Hono";
      if (allDeps["koa"]) return "Koa";
      if (allDeps["nestjs"] || allDeps["@nestjs/core"]) return "NestJS";
      if (allDeps["gatsby"]) return "Gatsby";
      if (allDeps["webpack-dev-server"]) return "Webpack";
      if (allDeps["esbuild"]) return "esbuild";
      if (allDeps["parcel"]) return "Parcel";
    } catch {}
  }

  if (
    existsSync(join(projectRoot, "vite.config.ts")) ||
    existsSync(join(projectRoot, "vite.config.js"))
  )
    return "Vite";
  if (
    existsSync(join(projectRoot, "next.config.js")) ||
    existsSync(join(projectRoot, "next.config.mjs"))
  )
    return "Next.js";
  if (existsSync(join(projectRoot, "angular.json"))) return "Angular";
  if (existsSync(join(projectRoot, "Cargo.toml"))) return "Rust";
  if (existsSync(join(projectRoot, "go.mod"))) return "Go";
  if (existsSync(join(projectRoot, "manage.py"))) return "Django";
  if (existsSync(join(projectRoot, "Gemfile"))) return "Ruby";

  return null;
}

function detectFrameworkFromCommand(command, processName) {
  if (!command) return detectFrameworkFromName(processName);
  const cmd = command.toLowerCase();

  if (cmd.includes("next")) return "Next.js";
  if (cmd.includes("vite")) return "Vite";
  if (cmd.includes("nuxt")) return "Nuxt";
  if (cmd.includes("angular") || cmd.includes("ng serve")) return "Angular";
  if (cmd.includes("webpack")) return "Webpack";
  if (cmd.includes("remix")) return "Remix";
  if (cmd.includes("astro")) return "Astro";
  if (cmd.includes("gatsby")) return "Gatsby";
  if (cmd.includes("flask")) return "Flask";
  if (cmd.includes("django") || cmd.includes("manage.py")) return "Django";
  if (cmd.includes("uvicorn")) return "FastAPI";
  if (cmd.includes("rails")) return "Rails";
  if (cmd.includes("cargo") || cmd.includes("rustc")) return "Rust";

  return detectFrameworkFromName(processName);
}

function detectFrameworkFromName(processName) {
  const name = (processName || "").toLowerCase();
  if (name === "node") return "Node.js";
  if (name === "python" || name === "python3") return "Python";
  if (name === "ruby") return "Ruby";
  if (name === "java") return "Java";
  if (name === "go") return "Go";
  return null;
}

/**
 * Extract a short description from a full command string.
 */
function summarizeCommand(command, processName) {
  const cmd = command || "";
  const parts = cmd.split(/\s+/);
  const meaningful = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue;
    if (part.startsWith("-")) continue;
    if (part.includes("/")) {
      meaningful.push(basename(part));
    } else {
      meaningful.push(part);
    }
    if (meaningful.length >= 3) break;
  }
  if (meaningful.length > 0) return meaningful.join(" ");
  return processName;
}

/**
 * Get all running processes (for `ports ps`).
 */
export async function getAllProcesses() {
  const platform = await getPlatform();
  const entries = platform.getAllProcessesRaw();

  const nonDockerEntries = entries.filter(
    (e) =>
      !e.processName.startsWith("com.docke") &&
      !e.processName.startsWith("Docker") &&
      e.processName !== "docker" &&
      e.processName !== "docker-sandbox",
  );
  const cwdMap = platform.batchCwd(nonDockerEntries.map((e) => e.pid));

  return entries.map((e) => {
    const cwd = cwdMap.get(e.pid);
    const info = {
      pid: e.pid,
      processName: e.processName,
      command: e.command,
      description: summarizeCommand(e.command, e.processName),
      cpu: e.cpu,
      memory: e.rss > 0 ? formatMemory(e.rss) : null,
      cwd: null,
      projectName: null,
      framework: null,
      uptime: null,
    };

    if (e.lstart) {
      const startTime = new Date(e.lstart);
      if (!isNaN(startTime.getTime())) {
        info.uptime = formatUptime(Date.now() - startTime.getTime());
      }
    }

    info.framework = detectFrameworkFromCommand(e.command, e.processName);

    if (cwd) {
      const projectRoot = findProjectRoot(cwd);
      info.cwd = projectRoot;
      info.projectName = basename(projectRoot);
      info.framework = info.framework || detectFramework(projectRoot);
    }

    return info;
  });
}

export async function findOrphanedProcesses() {
  const ports = await getListeningPorts();
  return ports.filter((p) => p.status === "orphaned" || p.status === "zombie");
}

export function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcess(pid, signal = "SIGTERM") {
  // Windows: SIGKILL not natively supported, use taskkill
  if (process.platform === "win32" && signal === "SIGKILL") {
    try {
      execSync(`taskkill /F /PID ${pid}`, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function resolveKillTarget(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  if (n <= 65535) {
    const info = await getPortDetails(n);
    if (info) return { pid: info.pid, via: "port", port: n, info };
  }
  if (pidExists(n)) return { pid: n, via: "pid" };
  return null;
}

export function watchPorts(callback, intervalMs = 2000) {
  let previousPorts = new Set();
  let running = false;

  const check = async () => {
    if (running) return;
    running = true;
    try {
      const current = await getListeningPorts();
      const currentSet = new Set(current.map((p) => p.port));

      for (const p of current) {
        if (!previousPorts.has(p.port)) {
          callback("new", p);
        }
      }

      for (const port of previousPorts) {
        if (!currentSet.has(port)) {
          callback("removed", { port });
        }
      }

      previousPorts = currentSet;
    } finally {
      running = false;
    }
  };

  check();
  return setInterval(check, intervalMs);
}

/**
 * Find log files for a given PID. Platform-aware:
 * - macOS/Linux: lsof to find open file descriptors
 * - Linux fallback: /proc/<pid>/fd symlinks
 * - Windows: common log path scanning
 * Returns array of { path, fd, type } sorted by relevance.
 */
export function getProcessLogFiles(pid) {
  const files = [];
  const plat = process.platform;

  if (plat === "darwin" || plat === "linux") {
    try {
      const raw = execSync(`lsof -p ${pid} 2>/dev/null`, {
        encoding: "utf8",
        timeout: 5000,
      }).trim();

      for (const line of raw.split("\n").slice(1)) {
        const cols = line.split(/\s+/);
        if (cols.length < 9) continue;

        const fd = cols[3];
        const type = cols[4];
        const name = cols.slice(8).join(" ");

        if ((fd === "1w" || fd === "2w") && type === "REG") {
          files.push({ path: name, fd: fd === "1w" ? "stdout" : "stderr", type: "redirect", priority: 1 });
          continue;
        }

        if (type === "REG" && /w$/.test(fd) && isLogLikePath(name)) {
          files.push({ path: name, fd: "file", type: "logfile", priority: 2 });
        }
      }
    } catch {
      // lsof not available — fall back to /proc on Linux
      if (plat === "linux") {
        try {
          const fdDir = `/proc/${pid}/fd`;
          for (const entry of readdirSync(fdDir)) {
            try {
              const target = readlinkSync(join(fdDir, entry));
              if (entry === "1" && !target.startsWith("/dev/") && !target.startsWith("pipe:")) {
                files.push({ path: target, fd: "stdout", type: "redirect", priority: 1 });
              } else if (entry === "2" && !target.startsWith("/dev/") && !target.startsWith("pipe:")) {
                files.push({ path: target, fd: "stderr", type: "redirect", priority: 1 });
              } else if (isLogLikePath(target)) {
                files.push({ path: target, fd: "file", type: "logfile", priority: 2 });
              }
            } catch {}
          }
        } catch {}
      }
    }
  }

  // Check common framework log locations relative to process cwd
  const cwdRaw = getProcessCwd(pid);
  if (cwdRaw) {
    const commonLogs = [
      ".next/server.log",
      "logs/development.log",
      "log/development.log",
      "tmp/pids/server.log",
      "storage/logs/laravel.log",
      "npm-debug.log",
      "yarn-error.log",
    ];
    for (const rel of commonLogs) {
      const full = join(cwdRaw, rel);
      if (existsSync(full)) {
        files.push({ path: full, fd: "file", type: "framework", priority: 3 });
      }
    }
  }

  files.sort((a, b) => a.priority - b.priority);
  const seen = new Set();
  return files.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

function isLogLikePath(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".log") ||
    lower.includes("/log/") ||
    lower.includes("/logs/") ||
    lower.includes("\\log\\") ||
    lower.includes("\\logs\\") ||
    lower.includes("/tmp/") ||
    lower.includes("nohup.out") ||
    lower.includes("stdout") ||
    lower.includes("stderr")
  );
}

function getProcessCwd(pid) {
  try {
    if (process.platform === "linux") {
      return execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
    }
    if (process.platform === "darwin") {
      return execSync(`lsof -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: "utf8", timeout: 3000 })
        .split("\n").find((l) => l.startsWith("n"))?.slice(1);
    }
    if (process.platform === "win32") {
      return execSync(
        `powershell -Command "(Get-Process -Id ${pid}).Path | Split-Path" 2>nul`,
        { encoding: "utf8", timeout: 5000 },
      ).trim() || null;
    }
  } catch {}
  return null;
}

/**
 * Get system log stream command for a PID (platform-specific).
 */
export function getSystemLogCommand(pid, follow = false) {
  if (process.platform === "darwin") {
    return follow
      ? `log stream --predicate 'processID == ${pid}' --style compact`
      : `log show --predicate 'processID == ${pid}' --style compact --last 1m`;
  }
  if (process.platform === "linux") {
    return follow
      ? `journalctl _PID=${pid} -f --no-pager`
      : `journalctl _PID=${pid} --no-pager -n 50`;
  }
  if (process.platform === "win32") {
    return `powershell -Command "Get-WinEvent -FilterHashtable @{LogName='Application'; ProcessId=${pid}} -MaxEvents 50"`;
  }
  return null;
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatMemory(rssKB) {
  if (rssKB > 1048576) return `${(rssKB / 1048576).toFixed(1)} GB`;
  if (rssKB > 1024) return `${(rssKB / 1024).toFixed(1)} MB`;
  return `${rssKB} KB`;
}
