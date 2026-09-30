# 团队指南：agents 按代理暴露范围（内部版）

本指南面向使用团队内部版 ZCode 的成员：如何获取内部版、如何使用 `agents` 按代理暴露范围功能、如何从官方原版迁移数据、以及如何跟进官方上游更新。行为规则与验收标准见 [specs/mcp-skill-agent-scoping.md](../specs/mcp-skill-agent-scoping.md)。

## 这是什么

MCP 工具定义会随**每一轮**模型请求完整发送，skill 目录也会随会话历史每轮可见。`agents` 字段允许你声明"某个 MCP server / 某个 skill 只给哪些代理看"：主 agent 每轮不再背负只有子代理用得上的工具定义，直接省 token；同时实现按代理隔离。

## 获取内部版

**方式 A：源码（推荐，团队有 Node 环境）**

```bash
git clone https://github.com/yali-apercus/ZCode.git
cd ZCode
pnpm install
pnpm build
pnpm dev:desktop        # 桌面端
```

**方式 B：构建产物分发**

```bash
pnpm build:zcode        # 产出 dist/zcode/，含自包含运行时与 install.sh
```

`dist/zcode` 可直接拷贝，或放内网 HTTP 后用 `install.sh --base-url http://<内网地址>/zcode/` 安装。

> Node 版本以 `mise.toml` 为准；桌面端安装包（Electron installer）的打包流程未在本仓库验证，桌面优先用方式 A。

## 功能用法

### 1. MCP server（设置页或配置文件）

设置页 → MCP 服务器 → 编辑表单中的"可见代理"，填逗号分隔名单；或直接写配置文件：

```json
{
  "mcp": {
    "servers": {
      "tavily": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "tavily-mcp"],
        "agents": ["researcher"]
      }
    }
  }
}
```

- 缺省 `agents`：所有代理可见（与官方版行为一致）。
- `"main"` 代表主 agent。主 agent 不在名单里 = 主 agent 的每轮请求不再携带该 server 的工具定义（省 token 的主要来源）。
- 子代理按 agent 定义的 `name` 匹配（内置的有 `Explore`、`general-purpose`）。
- server 连接仍由主会话持有；子代理要调用它，需在 agent 定义的 frontmatter 里声明 `mcpServers: [tavily]`（消费侧白名单，两处要一致）。

### 2. Skill（SKILL.md frontmatter）

```markdown
---
name: my-skill
description: ...
agents: main, researcher
---
```

- 只支持**逗号分隔标量**；写成 YAML 列表（`- item`）会静默失效（退回全可见）——这是 v1 已知限制。
- 带该字段不影响 `safeToAutoLoad`。

### 3. 子代理 agent 定义（消费侧，与 agents 字段配合）

```markdown
---
name: researcher
description: ...
mcpServers:
  - tavily
skills:
  - my-skill
---
```

- 子代理显式声明了一个拒绝它的 server → 启动直接报错（fail-closed），不会静默降级。
- `skills` 白名单与 skill 的 `agents` 取交集，白名单不能反向放宽暴露范围。

### 快速验收

配一个 `agents: ["researcher"]` 的 server 后：主 agent 的请求 tools 里看不到它；`researcher` 子代理可见可调用；`general-purpose` 看不到。

## 从官方原版迁移数据

**无需迁移。** 内部版与官方版是同一产品、同一数据布局：

| 数据 | 位置 | 迁移动作 |
|---|---|---|
| MCP 配置、会话历史、设置 | `~/.zcode` | 无（自动沿用） |
| 用户级 skills / agents | `~/.zcode/skills`、`~/.zcode/agents` | 无 |
| 工作区级配置 / skills | `<项目>/.zcode`、`<项目>/.agents` | 无 |

装好内部版即自动继承官方版的全部数据。若想**并存且隔离**（内部版与官方版各用各的数据），给内部版设置环境变量 `ZCODE_HOME` 指向独立目录（如 `D:\zcode-internal`）即可。

## 跟进官方上游更新

上游远端已配置（`upstream` = zai-org/ZCode）。**策略：merge，不 rebase**（保持两侧历史可追溯，spec 作为冲突后的行为核对依据）。

```bash
git fetch upstream
git merge upstream/main
# 解决冲突后必须验证：
pnpm typecheck
pnpm verify:pre-push
node --import tsx --test packages/core/test/*.test.ts packages/adapters/test/*.test.ts
```

冲突重点核对 `agents` 五个类型层是否齐全（官方若改了同一批文件）：`packages/shared/src/mcp.ts`（DTO + 白名单拷贝）、`packages/shared/src/zcode-protocol/index.ts`（共享 schema）、`apps/zcode-cli/packages/adapters/src/config/schema.ts`（文件 schema，漏了会整 server 被丢）、`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/protocol-mcp-config.ts`（协议→runtime 白名单）、`apps/zcode-cli/packages/contracts/src/interfaces/mcp.port.ts`（runtime 契约）。

## 已知限制（v1）

1. **滚动升级顺序**：`agents` 在协议 strict schema 内，旧版 agent 收到带该字段的请求会拒绝整个 server。升级时**先 CLI/agent 后 Desktop**；混版期间不要使用该字段。
2. SKILL.md 的 `agents` 只支持逗号分隔标量（见上）。
3. 主 agent 猜名字直接调用 Skill 加载未暴露的 skill 不拦截（目标是省 token 与子代理隔离，非安全边界）。
4. workflow 子代理的 skill 面按 actor 名匹配；其 MCP 面若持有独立连接则按主 agent 视角过滤。

## 本地验证命令备忘

```bash
pnpm typecheck                    # 根（不覆盖 apps/zcode-cli，见下）
pnpm --dir apps/zcode-cli -F @zcode/contracts build   # 改 contracts 后必须先构建（core 消费其 dist）
pnpm --dir apps/zcode-cli -F @zcode/core typecheck
pnpm verify:pre-push              # lint + 架构检查
node --import tsx --test packages/core/test/*.test.ts packages/adapters/test/*.test.ts   # 在 apps/zcode-cli 下执行
```
