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
