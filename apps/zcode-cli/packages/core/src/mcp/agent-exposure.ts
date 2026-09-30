// MCP server 按代理暴露范围（agents allowlist）的唯一判定源。
// 主 agent 注册过滤与子代理借用 denied 集合都必须经过这里，避免两处判定漂移。
// 语义见 specs/mcp-skill-agent-scoping.md：缺省全可见；声明后仅列出的代理可见。

import type { McpServerConfig, McpToolDescriptor } from "@zcode/contracts";
// 保留名 "main" 与 skill 侧共用一个定义，避免两处常量漂移。
import { MAIN_AGENT_EXPOSURE_NAME } from "../skills/agent-visibility.js";

export { MAIN_AGENT_EXPOSURE_NAME };

/**
 * 计算指定代理不可见的 MCP server 名集合。
 * `agents` 缺省（或配置缺失）= 全可见；声明了且不含 agentName = 拒绝。
 * 防御性规则：空 allowlist（`agents: []`）按字面语义视为对谁都不暴露——
 * 严格 schema 已用 min(1) 拒绝该形态，这里 fail-closed 兜底。
 */
export function computeAgentDeniedMcpServers(
  servers: Record<string, McpServerConfig>,
  agentName: string,
): Set<string> {
  const denied = new Set<string>();
  for (const [name, config] of Object.entries(servers)) {
    if (config.agents === undefined) continue;
    if (!config.agents.includes(agentName)) denied.add(name);
  }
  return denied;
}

/** 按主 agent 视角过滤工具描述符（initializeMcp 注册进主 registry 前调用）。 */
export function filterToolsExposedToAgent(
  tools: readonly McpToolDescriptor[],
  servers: Record<string, McpServerConfig>,
  agentName: string,
): McpToolDescriptor[] {
  const denied = computeAgentDeniedMcpServers(servers, agentName);
  if (denied.size === 0) return [...tools];
  return tools.filter((descriptor) => !denied.has(descriptor.serverName));
}

/**
 * 子代理显式 `mcpServers` 声明中命中 denied 集合的 server。
 * 非空时调用方必须 fail-closed 抛配置错误，不允许静默缩小借用范围。
 */
export function findDeniedDeclaredMcpServers(
  declaredServerNames: readonly string[] | undefined,
  deniedServerNames: ReadonlySet<string>,
): string[] {
  if (!declaredServerNames?.length) return [];
  return declaredServerNames.filter((name) => deniedServerNames.has(name));
}
