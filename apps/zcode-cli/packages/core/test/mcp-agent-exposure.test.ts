// agents allowlist 判定的纯函数回归网（specs/mcp-skill-agent-scoping.md 验收场景 1/3）。
// 运行：在 apps/zcode-cli 下 `node --import tsx --test packages/core/test/*.test.ts`。

import assert from "node:assert/strict";
import test from "node:test";
import type { McpServerConfig, McpToolDescriptor } from "@zcode/contracts";

import {
  MAIN_AGENT_EXPOSURE_NAME,
  computeAgentDeniedMcpServers,
  filterToolsExposedToAgent,
  findDeniedDeclaredMcpServers,
} from "../src/mcp/agent-exposure.js";

function stdioServer(overrides: Partial<Extract<McpServerConfig, { type: "stdio" }>> = {}): McpServerConfig {
  return { type: "stdio", command: "uvx", ...overrides } satisfies McpServerConfig;
}

function descriptor(serverName: string, toolName = "query"): McpToolDescriptor {
  return { serverName, toolName } as unknown as McpToolDescriptor;
}

test("MAIN_AGENT_EXPOSURE_NAME is the reserved main agent name", () => {
  assert.equal(MAIN_AGENT_EXPOSURE_NAME, "main");
});

test("servers without agents stay visible to every agent", () => {
  const servers = { tavily: stdioServer() };
  assert.deepEqual(
    [...computeAgentDeniedMcpServers(servers, MAIN_AGENT_EXPOSURE_NAME)],
    [],
  );
  assert.deepEqual([...computeAgentDeniedMcpServers(servers, "researcher")], []);
});

test("agents allowlist denies servers that do not list the agent", () => {
  const servers = {
    tavily: stdioServer({ agents: ["researcher"] }),
    filesystem: stdioServer({ agents: [MAIN_AGENT_EXPOSURE_NAME, "researcher"] }),
  };
  const deniedForMain = computeAgentDeniedMcpServers(servers, MAIN_AGENT_EXPOSURE_NAME);
  assert.ok(deniedForMain.has("tavily"));
  assert.ok(!deniedForMain.has("filesystem"));

  const deniedForResearcher = computeAgentDeniedMcpServers(servers, "researcher");
  assert.ok(!deniedForResearcher.has("tavily"));
  assert.ok(!deniedForResearcher.has("filesystem"));

  const deniedForOther = computeAgentDeniedMcpServers(servers, "general-purpose");
  assert.ok(deniedForOther.has("tavily"));
  assert.ok(deniedForOther.has("filesystem"));
});

test("empty allowlist is fail-closed (visible to nobody)", () => {
  const servers = { tavily: stdioServer({ agents: [] }) };
  assert.ok(computeAgentDeniedMcpServers(servers, MAIN_AGENT_EXPOSURE_NAME).has("tavily"));
  assert.ok(computeAgentDeniedMcpServers(servers, "researcher").has("tavily"));
});

test("filterToolsExposedToAgent keeps descriptor order and drops hidden servers", () => {
  const servers = { tavily: stdioServer({ agents: ["researcher"] }) };
  const tools = [descriptor("tavily"), descriptor("filesystem"), descriptor("tavily", "extract")];
  assert.deepEqual(
    filterToolsExposedToAgent(tools, servers, MAIN_AGENT_EXPOSURE_NAME).map((t) => t.serverName),
    ["filesystem"],
  );
  assert.deepEqual(
    filterToolsExposedToAgent(tools, servers, "researcher").map((t) => t.serverName),
    ["tavily", "filesystem", "tavily"],
  );
  assert.equal(filterToolsExposedToAgent(tools, {}, "researcher").length, tools.length);
});

test("findDeniedDeclaredMcpServers only reports declared servers hit by the denial set", () => {
  const denied = new Set(["tavily"]);
  assert.deepEqual(findDeniedDeclaredMcpServers(undefined, denied), []);
  assert.deepEqual(findDeniedDeclaredMcpServers([], denied), []);
  assert.deepEqual(findDeniedDeclaredMcpServers(["tavily"], denied), ["tavily"]);
  assert.deepEqual(
    findDeniedDeclaredMcpServers(["tavily", "filesystem"], denied),
    ["tavily"],
  );
  assert.deepEqual(findDeniedDeclaredMcpServers(["filesystem"], denied), []);
});
