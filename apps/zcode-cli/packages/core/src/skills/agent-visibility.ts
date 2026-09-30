// skill 按代理暴露范围（agents allowlist）的唯一判定源。
// 目录注入（buildSkillsSection）与子代理加载拦截（FilteredSkillPort）都必须经过这里，
// 避免两处判定漂移。语义见 specs/mcp-skill-agent-scoping.md。

import type { SkillMetadata } from "@zcode/contracts";

/** 主 agent 在 agents allowlist 中的保留名；MCP 侧（core/src/mcp/agent-exposure.ts）共用。 */
export const MAIN_AGENT_EXPOSURE_NAME = "main";

/**
 * agents allowlist 可见性判定：缺省全可见；声明后仅列出的代理可见。
 * agentName 未知（undefined）时按"不在名单即隐藏"处理（fail-closed）——
 * 没有可靠身份的 workflow 子代理不应看到限定给特定代理的 skill。
 */
export function isSkillExposedToAgent(
  skill: Pick<SkillMetadata, "agents">,
  agentName: string | undefined,
): boolean {
  if (skill.agents === undefined) return true;
  return agentName !== undefined && skill.agents.includes(agentName);
}
