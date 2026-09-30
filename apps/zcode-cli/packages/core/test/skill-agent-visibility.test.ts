// skill 按代理暴露范围判定的回归网（specs/mcp-skill-agent-scoping.md 验收场景 4）。
// 运行：在 apps/zcode-cli 下 `node --import tsx --test packages/core/test/*.test.ts`。

import assert from "node:assert/strict";
import test from "node:test";
import type { SkillLoadOutcome, SkillMetadata } from "@zcode/contracts";

import { isSkillExposedToAgent, MAIN_AGENT_EXPOSURE_NAME } from "../src/skills/agent-visibility.js";
import { buildSkillsSection } from "../src/context/sections/skills.js";

function metadata(name: string, agents?: string[]): SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `/skills/${name}/SKILL.md`,
    directory: `/skills/${name}`,
    rootPath: "/skills",
    scope: "project",
    source: "agents",
    safeToAutoLoad: true,
    frontmatterKeys: ["name", "description"],
    ...(agents ? { agents } : {}),
  };
}

function outcome(...skills: SkillMetadata[]): SkillLoadOutcome {
  return { skills, diagnostics: [], totalDiscovered: skills.length };
}

test("unrestricted skills are visible to every agent including unknown identity", () => {
  const skill = metadata("plain");
  assert.equal(isSkillExposedToAgent(skill, MAIN_AGENT_EXPOSURE_NAME), true);
  assert.equal(isSkillExposedToAgent(skill, "researcher"), true);
  assert.equal(isSkillExposedToAgent(skill, undefined), true);
});

test("restricted skills hide from agents outside the allowlist and from unknown identity", () => {
  const skill = metadata("scoped", ["researcher"]);
  assert.equal(isSkillExposedToAgent(skill, "researcher"), true);
  assert.equal(isSkillExposedToAgent(skill, MAIN_AGENT_EXPOSURE_NAME), false);
  assert.equal(isSkillExposedToAgent(skill, "general-purpose"), false);
  assert.equal(isSkillExposedToAgent(skill, undefined), false);
});

test("main allowlist entry keeps the skill visible to the main agent only", () => {
  const skill = metadata("main-only", [MAIN_AGENT_EXPOSURE_NAME]);
  assert.equal(isSkillExposedToAgent(skill, MAIN_AGENT_EXPOSURE_NAME), true);
  assert.equal(isSkillExposedToAgent(skill, "researcher"), false);
});

test("buildSkillsSection filters entries by agent exposure", () => {
  const load = outcome(
    metadata("plain"),
    metadata("researcher-only", ["researcher"]),
    metadata("main-only", [MAIN_AGENT_EXPOSURE_NAME]),
  );

  const mainSection = buildSkillsSection({ outcome: load, agentName: MAIN_AGENT_EXPOSURE_NAME });
  assert.ok(mainSection);
  assert.match(mainSection.content, /plain/);
  assert.match(mainSection.content, /main-only/);
  assert.doesNotMatch(mainSection.content, /researcher-only/);

  const researcherSection = buildSkillsSection({ outcome: load, agentName: "researcher" });
  assert.ok(researcherSection);
  assert.match(researcherSection.content, /plain/);
  assert.match(researcherSection.content, /researcher-only/);
  assert.doesNotMatch(researcherSection.content, /main-only/);
});

test("buildSkillsSection without identity hides restricted skills entirely", () => {
  const load = outcome(metadata("plain"), metadata("scoped", ["researcher"]));

  const section = buildSkillsSection({ outcome: load });
  assert.ok(section);
  assert.match(section.content, /plain/);
  assert.doesNotMatch(section.content, /scoped/);

  // 全部 skill 被过滤时不得输出空 Skills 段。
  const restrictedOnly = buildSkillsSection({ outcome: outcome(metadata("scoped", ["a"])) });
  assert.equal(restrictedOnly, null);
});
