// initializeMcp 主 registry 注册过滤的回归网（specs/mcp-skill-agent-scoping.md 验收场景 1/3）：
// agents allowlist 拒绝的 server 工具不得进入主 registry；连接快照与幂等性不受影响。
// 运行：在 apps/zcode-cli 下 `node --import tsx --test packages/core/test/*.test.ts`。

import assert from "node:assert/strict";
import test from "node:test";
import type { McpConnectionSnapshot, McpPort, McpServerConfig, McpToolDescriptor, TraceContext } from "@zcode/contracts";

import { createToolRegistry } from "../src/tool/index.js";
import { initializeMcp } from "../src/runtime/methods/mcp.js";

function stdioServer(overrides: Partial<Extract<McpServerConfig, { type: "stdio" }>> = {}): McpServerConfig {
  return { type: "stdio", command: "uvx", ...overrides } satisfies McpServerConfig;
}

function descriptor(serverName: string, toolName: string): McpToolDescriptor {
  return { serverName, toolName } as unknown as McpToolDescriptor;
}

interface FakeRuntime {
  mcpPort: McpPort;
  registry: ReturnType<typeof createToolRegistry>;
  config: Record<string, unknown>;
  logger?: undefined;
  mcpInitialized: boolean;
  mcpToolsRegistered: boolean;
  mcpStartupPromise?: Promise<McpConnectionSnapshot>;
}

function createFakeRuntime(
  servers: Record<string, McpServerConfig>,
  tools: McpToolDescriptor[],
): FakeRuntime & { startMcpStartup(): Promise<McpConnectionSnapshot> } {
  const snapshot: McpConnectionSnapshot = {
    statuses: Object.fromEntries(
      Object.keys(servers).map((name) => [name, { status: "connected", transport: "stdio", toolCount: 1, updatedAt: "" }]),
    ),
    tools,
  };
  const runtime = {
    mcpPort: {} as McpPort,
    registry: createToolRegistry(),
    config: { mcp: { enabled: true, servers, trustedOfficialCuaServerNames: [] } },
    mcpInitialized: false,
    mcpToolsRegistered: false,
    // startMcpStartup 的连接编排不在本单测职责内，直接注入目标快照。
    startMcpStartup(): Promise<McpConnectionSnapshot> {
      return Promise.resolve(snapshot);
    },
  };
  return runtime;
}

const TRACE = {} as TraceContext;

test("initializeMcp keeps denied servers out of the main registry", async () => {
  const servers = {
    tavily: stdioServer({ agents: ["researcher"] }),
    filesystem: stdioServer({ agents: ["main", "researcher"] }),
  };
  const runtime = createFakeRuntime(servers, [
    descriptor("tavily", "search"),
    descriptor("tavily", "extract"),
    descriptor("filesystem", "read"),
  ]);

  await initializeMcp.call(runtime as never, TRACE);

  const names = runtime.registry.toContracts().map((contract) => contract.name).sort();
  assert.deepEqual(names, ["mcp__filesystem__read"]);
  assert.equal(runtime.mcpToolsRegistered, true);
});

test("initializeMcp without agents restrictions registers every connected tool (regression)", async () => {
  const servers = { tavily: stdioServer(), filesystem: stdioServer() };
  const runtime = createFakeRuntime(servers, [
    descriptor("tavily", "search"),
    descriptor("filesystem", "read"),
  ]);

  await initializeMcp.call(runtime as never, TRACE);

  const names = runtime.registry.toContracts().map((contract) => contract.name).sort();
  assert.deepEqual(names, ["mcp__filesystem__read", "mcp__tavily__search"]);
});

test("initializeMcp is idempotent and does not double-register", async () => {
  const servers = { tavily: stdioServer() };
  const runtime = createFakeRuntime(servers, [descriptor("tavily", "search")]);

  await initializeMcp.call(runtime as never, TRACE);
  await initializeMcp.call(runtime as never, TRACE);

  assert.equal(runtime.registry.toContracts().length, 1);
});
