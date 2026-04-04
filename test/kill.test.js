import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock scanner.js before importing handleKill
vi.mock("../src/scanner.js", () => ({
  getPortDetails: vi.fn(),
  killProcess: vi.fn(),
  getListeningPorts: vi.fn(),
  isDevProcess: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
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

import { getPortDetails, killProcess, getListeningPorts, isDevProcess } from "../src/scanner.js";
import { checkbox } from "@inquirer/prompts";
import { handleKill, interactiveKill } from "../src/index.js";

describe("handleKill", () => {
  let output;

  beforeEach(() => {
    vi.clearAllMocks();
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      output.push(args.join(" ")),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

describe("interactiveKill", () => {
  let output;

  beforeEach(() => {
    vi.clearAllMocks();
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      output.push(args.join(" ")),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows checkbox and kills selected ports", async () => {
    getListeningPorts.mockReturnValue([
      { port: 3000, pid: 111, processName: "node", framework: "Next.js", projectName: "frontend", command: "node server.js" },
      { port: 5173, pid: 222, processName: "node", framework: "Vite", projectName: "dashboard", command: "node vite.js" },
    ]);
    isDevProcess.mockReturnValue(true);
    checkbox.mockResolvedValue([3000, 5173]);
    getPortDetails.mockReturnValueOnce({ pid: 111, port: 3000, processName: "node", framework: "Next.js", projectName: "frontend" })
      .mockReturnValueOnce({ pid: 222, port: 5173, processName: "node", framework: "Vite", projectName: "dashboard" });
    killProcess.mockReturnValue(true);

    const code = await interactiveKill();

    expect(checkbox).toHaveBeenCalledTimes(1);
    expect(killProcess).toHaveBeenCalledTimes(2);
    expect(code).toBe(0);
  });

  it("prints message and skips prompt when no ports active", async () => {
    getListeningPorts.mockReturnValue([]);

    const code = await interactiveKill();

    expect(checkbox).not.toHaveBeenCalled();
    expect(code).toBe(0);
    expect(output.some((line) => line.includes("No active dev ports"))).toBe(true);
  });

  it("returns 0 when user selects nothing", async () => {
    getListeningPorts.mockReturnValue([
      { port: 3000, pid: 111, processName: "node", framework: "Next.js", projectName: "frontend", command: "node server.js" },
    ]);
    isDevProcess.mockReturnValue(true);
    checkbox.mockResolvedValue([]);

    const code = await interactiveKill();

    expect(killProcess).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it("returns 0 when user cancels with Ctrl+C", async () => {
    getListeningPorts.mockReturnValue([
      { port: 3000, pid: 111, processName: "node", framework: "Next.js", projectName: "frontend", command: "node server.js" },
    ]);
    isDevProcess.mockReturnValue(true);
    checkbox.mockRejectedValue(new Error("User force closed the prompt"));

    const code = await interactiveKill();

    expect(killProcess).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});
