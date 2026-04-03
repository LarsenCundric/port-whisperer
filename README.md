# port-whisperer

**A beautiful CLI tool to see what's running on your ports.**

Stop guessing which process is hogging port 3000. `port-whisperer` gives you a color-coded table of every dev server, database, and background process listening on your machine -- with framework detection, git info, and interactive process management.

## What it looks like

```
$ ports

  Port   Process        PID     Project            Framework   Uptime    Status
  -----  -------------  ------  -----------------  ----------  --------  --------
  3000   node           41234   ~/dev/my-app       Next.js     2h 14m   healthy
  5173   node           41300   ~/dev/dashboard    Vite        45m      healthy
  5432   postgres       1028    -                  PostgreSQL  3d 7h    healthy
  8080   node           52887   ~/dev/old-api      Express     6d 2h    orphaned
```

Colors: green = healthy, yellow = orphaned, red = zombie.

## Install

```bash
npm install -g port-whisperer
```

Or run it directly without installing:

```bash
npx port-whisperer
```

### Or let Claude Code install it for you

If you use [Claude Code](https://claude.ai/code), you can ask it to `npm install -g port-whisperer` and start using `ports` right away -- no setup steps needed.

## Usage

### Show dev server ports

```bash
ports
```

Displays a table of common dev server ports with process name, PID, project directory, detected framework, uptime, and health status.

### Show all listening ports

```bash
ports --all
```

Includes system services, databases, and everything else listening on your machine.

### Inspect a specific port

```bash
ports 3000
# or
whoisonport 3000
```

Detailed view of a single port: full process tree, repository path, current git branch, memory usage, and an interactive prompt to kill the process if needed.

### Clean up orphaned processes

```bash
ports clean
```

Finds and kills orphaned or zombie dev server processes that are still holding onto ports after you've stopped working on a project.

### Watch for port changes

```bash
ports watch
```

Real-time monitoring that updates whenever a port starts or stops listening.

## How it works

`port-whisperer` combines three shell calls to build a complete picture of each port:

1. **`lsof -iTCP -sTCP:LISTEN`** -- finds all processes listening on TCP ports
2. **`ps`** -- retrieves process details (command line, uptime, memory)
3. **`lsof -p <pid>`** -- resolves the working directory of each process to detect the project and framework

Framework detection works by reading `package.json` dependencies and inspecting process command lines. It recognizes Next.js, Vite, Express, Angular, Django, Rails, and many others.

## Platform support

| Platform | Status |
|----------|--------|
| macOS    | Supported (uses `lsof`) |
| Linux    | Planned |
| Windows  | Not planned |

## License

[MIT](LICENSE)
