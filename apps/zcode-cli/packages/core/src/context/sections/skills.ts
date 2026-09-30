// ============================================================
// Skills Section Builder
// ============================================================

import type { SkillLoadOutcome, SkillMetadata } from "@zcode/contracts";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";
import { isSkillExposedToAgent } from "../../skills/agent-visibility.js";

const DEFAULT_SKILL_METADATA_BUDGET = 20_000;
const MAX_DESCRIPTION_CHARS = 250;

interface SkillsSectionOptions {
  outcome: SkillLoadOutcome;
  metadataBudget?: number;
  /**
   * 当前 context 的代理暴露身份：主 agent 传 "main"，runner 子代理传 profile.name；
   * 未提供（workflow 子代理等无身份场景）时，声明了 `agents` 的 skill 一律隐藏（fail-closed）。
   */
  agentName?: string;
}

export function buildSkillsSection(options: SkillsSectionOptions): ContextSection | null {
  const visibleSkills = options.outcome.skills.filter((skill) =>
    isSkillExposedToAgent(skill, options.agentName),
  );
  if (visibleSkills.length === 0) {
    return null;
  }

  const content = buildSkillsContent(
    visibleSkills,
    options.metadataBudget ?? DEFAULT_SKILL_METADATA_BUDGET,
  );

  return {
    name: "Skills",
    source: "skills",
    injectionTarget: "meta_user",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}

function buildSkillsContent(skills: SkillMetadata[], budget: number): string {
  const lines = [
    "The following skills are available for use with the Skill tool:",
    "",
  ];

  const sortedSkills = [...skills].sort((a, b) =>
    skillDisplayName(a).localeCompare(skillDisplayName(b)),
  );
  const skillLines = sortedSkills.map((skill) => formatSkillLine(skill, MAX_DESCRIPTION_CHARS));
  const full = [...lines, ...skillLines].join("\n");
  if (full.length <= budget) {
    return full;
  }

  const namesOnly = sortedSkills.map(
    (skill) => `- ${skillDisplayName(skill)}${bareAliasSuffix(skill)} (file: ${skill.path})`,
  );
  return [...lines, ...namesOnly].join("\n");
}

function formatSkillLine(skill: SkillMetadata, maxDescriptionChars: number): string {
  const description = skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description;
  const trimmed =
    description.length > maxDescriptionChars
      ? `${description.slice(0, maxDescriptionChars - 1)}...`
      : description;
  return `- ${skillDisplayName(skill)}: ${trimmed}${bareAliasSuffix(skill)} (file: ${skill.path})`;
}

function skillDisplayName(skill: SkillMetadata): string {
  return skill.qualifiedName ?? skill.name;
}

function bareAliasSuffix(skill: SkillMetadata): string {
  return skill.qualifiedName && skill.qualifiedName !== skill.name
    ? ` (also loadable as ${skill.name})`
    : "";
}
