// FilteredSkillPort 拦截路径的回归网（specs/mcp-skill-agent-scoping.md 验收场景 4）：
// agents allowlist 与 profile.skills 白名单取交集，同时约束目录发现与 loadSkill。
// 运行：在 apps/zcode-cli 下 `node --import tsx --test packages/core/test/*.test.ts`。

import assert from "node:assert/strict";
import test from "node:test";
import type {
  SkillContent,
  SkillDiscoverRequest,
  SkillLoadOutcome,
  SkillMetadata,
  SkillPort,
} from "@zcode/contracts";

import { FilteredSkillPort } from "../src/skills/filtered-skill-port.js";
import { createOfficialCuaPolicy } from "../src/subagent/computer-use-policy.js";

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

function createParentPort(skills: SkillMetadata[]) {
  const loadCalls: string[] = [];
  const parent: SkillPort = {
    async discoverSkills(_request: SkillDiscoverRequest): Promise<SkillLoadOutcome> {
      return { skills, diagnostics: [], totalDiscovered: skills.length };
    },
    async loadSkill(request): Promise<SkillContent> {
      loadCalls.push(request.name);
      const skill = skills.find((candidate) => candidate.name === request.name) ?? skills[0]!;
      return {
        metadata: skill,
        content: "body",
        baseDirectory: skill.directory,
        bytesRead: 4,
        sizeBytes: 4,
        truncated: false,
      };
    },
  };
  return { parent, loadCalls };
}

const POLICY = createOfficialCuaPolicy(new Set(), [], undefined);

function createPort(
  skills: SkillMetadata[],
  options: { allowedSkills?: string[]; agentExposureName?: string } = {},
): { port: FilteredSkillPort; loadCalls: string[] } {
  const { parent, loadCalls } = createParentPort(skills);
  const port = new FilteredSkillPort(
    parent,
    options.allowedSkills ? new Set(options.allowedSkills) : undefined,
    options.agentExposureName,
    POLICY,
  );
  return { port, loadCalls };
}

const CATALOG = [
  metadata("plain"),
  metadata("researcher-only", ["researcher"]),
  metadata("main-only", ["main"]),
];

test("discoverSkills filters catalog by agents exposure identity", async () => {
  const researcher = createPort(CATALOG, { agentExposureName: "researcher" });
  const researcherOutcome = await researcher.port.discoverSkills({
    workingDirectory: "/ws",
  });
  assert.deepEqual(
    researcherOutcome.skills.map((skill) => skill.name),
    ["plain", "researcher-only"],
  );
  assert.equal(researcherOutcome.totalDiscovered, 2);

  const main = createPort(CATALOG, { agentExposureName: "main" });
  assert.deepEqual(
    (await main.port.discoverSkills({ workingDirectory: "/ws" })).skills.map((s) => s.name),
    ["plain", "main-only"],
  );

  const anonymous = createPort(CATALOG);
  assert.deepEqual(
    (await anonymous.port.discoverSkills({ workingDirectory: "/ws" })).skills.map((s) => s.name),
    ["plain"],
  );
});

test("profile whitelist intersects with the agents allowlist", async () => {
  // 白名单收窄：plain 虽对 researcher 可见，但不在白名单内。
  const narrowed = createPort(CATALOG, {
    allowedSkills: ["researcher-only"],
    agentExposureName: "researcher",
  });
  assert.deepEqual(
    (await narrowed.port.discoverSkills({ workingDirectory: "/ws" })).skills.map((s) => s.name),
    ["researcher-only"],
  );

  // 白名单不能反向放宽：main-only 对 researcher 不可见，即使写进白名单。
  const widened = createPort(CATALOG, {
    allowedSkills: ["plain", "main-only"],
    agentExposureName: "researcher",
  });
  assert.deepEqual(
    (await widened.port.discoverSkills({ workingDirectory: "/ws" })).skills.map((s) => s.name),
    ["plain"],
  );
});

test("loadSkill resolves allowed skills through the parent port", async () => {
  const { port, loadCalls } = createPort(CATALOG, { agentExposureName: "researcher" });
  const content = await port.loadSkill({ name: "researcher-only", workingDirectory: "/ws" });
  assert.equal(content.metadata.name, "researcher-only");
  assert.deepEqual(loadCalls, ["researcher-only"]);
});

test("loadSkill hard-fails for skills hidden by the agents allowlist", async () => {
  const { port, loadCalls } = createPort(CATALOG, { agentExposureName: "main" });
  await assert.rejects(
    port.loadSkill({ name: "researcher-only", workingDirectory: "/ws" }),
    /Skill is not allowed for subagent/,
  );
  assert.deepEqual(loadCalls, []);
});

test("loadSkill hard-fails for names outside the catalog entirely", async () => {
  const { port, loadCalls } = createPort(CATALOG, { agentExposureName: "researcher" });
  await assert.rejects(
    port.loadSkill({ name: "unknown-skill", workingDirectory: "/ws" }),
    /Skill is not allowed for subagent/,
  );
  assert.deepEqual(loadCalls, []);
});
