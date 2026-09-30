// SKILL.md frontmatter `agents` 字段解析回归网（specs/mcp-skill-agent-scoping.md 验收场景 4）。
// 运行：在 apps/zcode-cli 下 `node --import tsx --test packages/adapters/test/*.test.ts`。

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SkillLoadOutcome, SkillRoot } from "@zcode/contracts";

import { NodeSkillAdapter } from "../src/skills/index.js";

async function withSkillRoot(
  files: Record<string, string>,
  run: (rootPath: string, discover: () => Promise<SkillLoadOutcome>) => Promise<void>,
): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "zcode-skill-agents-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(rootPath, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const adapter = new NodeSkillAdapter();
    const root: SkillRoot = { path: rootPath, scope: "project", source: "agents", priority: 0 };
    await run(rootPath, () =>
      adapter.discoverSkills({ workingDirectory: rootPath, roots: [root] }),
    );
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }
}

const SKILL_BODY = "Use this skill when testing agents exposure.\n";

test("agents frontmatter parses as comma-separated allowlist", async () => {
  await withSkillRoot(
    {
      "SKILL.md": `---\nname: scoped\ndescription: scoped skill\nagents: main, researcher\n---\n${SKILL_BODY}`,
    },
    async (_rootPath, discover) => {
      const outcome = await discover();
      assert.equal(outcome.skills.length, 1);
      assert.deepEqual(outcome.skills[0]?.agents, ["main", "researcher"]);
      // agents 已在 SAFE_FRONTMATTER_KEYS 白名单内，不得把 skill 翻成 unsafe。
      assert.equal(outcome.skills[0]?.safeToAutoLoad, true);
    },
  );
});

test("quoted agents value is unwrapped", async () => {
  await withSkillRoot(
    {
      "SKILL.md": `---\nname: quoted\ndescription: quoted agents\nagents: "main"\n---\n${SKILL_BODY}`,
    },
    async (_rootPath, discover) => {
      const outcome = await discover();
      assert.deepEqual(outcome.skills[0]?.agents, ["main"]);
    },
  );
});

test("missing or blank agents stays undefined (visible to every agent)", async () => {
  await withSkillRoot(
    {
      "a/SKILL.md": `---\nname: plain\ndescription: no agents field\n---\n${SKILL_BODY}`,
      "b/SKILL.md": `---\nname: blank\ndescription: blank agents\nagents: ""\n---\n${SKILL_BODY}`,
    },
    async (_rootPath, discover) => {
      const outcome = await discover();
      // discoverSkills 按 name 排序（blank < plain）。
      assert.deepEqual(
        outcome.skills.map((skill) => [skill.name, skill.agents]),
        [
          ["blank", undefined],
          ["plain", undefined],
        ],
      );
    },
  );
});

test("yaml list form is not parsed in v1 (documented limitation)", async () => {
  await withSkillRoot(
    {
      "SKILL.md": `---\nname: listform\ndescription: yaml list form\nagents:\n  - main\n---\n${SKILL_BODY}`,
    },
    async (_rootPath, discover) => {
      const outcome = await discover();
      // 块列表行被扁平解析器按缩进行跳过，agents 退化为未声明（全可见）；
      // spec 明确第一版只支持逗号分隔标量。
      assert.equal(outcome.skills[0]?.agents, undefined);
    },
  );
});
