# Spec: MCP server 与 skill 的按代理暴露范围（agents allowlist）

## 背景与问题

MCP 工具定义在每次模型请求的 `tools` 字段完整序列化，skill 目录以 system-reminder 形式随历史每轮重发（见 `apps/zcode-cli` 的 `initializeMcp` / `buildSkillsSection`）。所有已连接 MCP server 的工具定义与全部 skill 目录条目无条件进入主 agent 与所有子代理的上下文，即使某 server/skill 只有特定子代理用得上，token 成本由每一轮共同承担。

消费侧已有按代理裁剪机制：子代理 profile 的 `mcpServers`（borrow port 按 server 过滤）与 `skills`（FilteredSkillPort 白名单）。但供给侧没有对应表达——无法声明"这个 server/skill 只暴露给某些代理"，父级 `toolDisallowlist` 又会传染所有子代理（`buildSubagentChildDisallowRules`），不能用来实现"主 agent 不背、特定子代理可见"。

## 规则

- 新增供给侧 allowlist 字段 `agents`：
  - MCP server 配置（stdio/http/sse 通用）与 SKILL.md frontmatter 均可声明 `agents`。
  - 语义：缺省 = 所有代理可见（现状不变）；声明后 = 仅列出的代理可见。
  - 主 agent 用保留名 `"main"`；子代理按 `AgentProfile.name` 匹配（含内置 `Explore`、`general-purpose`）。
  - 第一版值格式：逗号分隔标量（SKILL.md：`agents: main, researcher`；MCP 配置文件/UI：字符串数组）。skill 解析器不支持 YAML 列表语法，不做列表解析。
- MCP server 的**连接仍由主 runtime 持有并连接**（子代理借用父快照），`agents` 只过滤"工具定义注入"：
  - 主 agent：`initializeMcp` 注册进主 `ToolRegistry` 前按 server 名过滤，未暴露给 `"main"` 的 server 工具不注册（模型请求的 `tools` 数组不再包含）。
  - 子代理：`resolveSubagentMcpAccess` 计算 denied 集合（官方 CUA ∪ 按 profile.name 未暴露的 server），复用 `createBorrowedSubagentMcpAccess` 的 `deniedServerNames` 过滤快照与 `callTool`。
- fail-closed：子代理 profile 显式 `mcpServers` 声明了拒绝它的 server → 抛配置错误（与 server 未连接同风格）；该冲突检查位于 MCP disabled / 快照缺失等可用性检查之后，环境错误优先呈现。继承模式的子代理只是看不到该 server。
- skill 目录注入过滤收口在 `buildSkillsSection`（主 agent 与子代理 context builder 的共同边界），按代理身份过滤条目；`skillLoadOutcome` 本体保持全量。
- 子代理 `loadSkill` 硬拦截：`FilteredSkillPort`（`core/src/skills/filtered-skill-port.ts`）在 profile.skills 白名单之上增加 agents 暴露校验（两条件取交集，白名单不能反向放宽暴露范围），不在名单的 skill 拒绝加载。
- 身份来源：主 agent 固定 `"main"`；runner 子代理按 `AgentProfile.name`；workflowActor 子代理按 `workflowActor.name`（匿名时按"不在 allowlist 即隐藏"fail-closed）。
- 值语义：MCP 侧 strict schema（文件与协议层）拒绝空数组（`min(1)`，非法配置整 server 丢弃并告警）；SKILL.md 的 `agents` 为逗号分隔标量，空白项剔除、空名单视为未声明（全可见）。
- 类型必须穿过全部严格层：文件配置 zod schema、协议 schema（`zcodeProtocolMcpServerSchema`，一次修改多处复用）、协议→runtime 白名单重建、runtime 契约（`McpServerConfigBase`）、UI DTO（`ZCodeAgentMcpServer` + `convertToZCodeAgentMcpServer`）。漏层会导致字段被 strict 校验或白名单拷贝静默丢弃。

## 不变量

- `agents` 缺省时行为与改动前完全一致（所有代理可见）。
- 被过滤只发生在"定义/目录注入"边界；server 连接状态、`mcp/list` 状态查询、UI/CLI 的 skill 管理列表、context-usage 统计均保持全量。
- 单一过滤判定源：MCP 暴露判定收口在 `computeAgentDeniedMcpServers`（core/src/mcp/agent-exposure.ts），skill 暴露判定收口在 `isSkillExposedToAgent`（core/src/skills/agent-visibility.ts），主 agent 与子代理两侧共用，不另起并行过滤。

## 已知限制（v1 接受）

- 主 agent 猜名字调用 Skill 工具加载未暴露 skill 不拦截（主 agent 是可信调度者，本字段目标是省 token 与子代理隔离）。
- 滚动升级：`agents` 位于协议 server 对象的 strict schema 内，旧版 CLI 收到带该字段的 create/resume 请求会拒绝整个 server（现有兼容重试只剥顶层未识别键，救不了嵌套键）。部署顺序必须先升级 CLI/agent 再升级 Desktop，或在旧 CLI 环境暂不使用该字段。
- workflowActor 子运行时若持有自己的 MCP 连接，其 MCP 工具面按主 agent 视角过滤（`initializeMcp` 固定 `"main"`）；skill 面按 actor 名过滤。两条通道的粒度差异接受为 v1 行为。
- 子代理对 required server 的报错消息沿用"not connected"风格（显式声明的 allowlist 冲突有独立消息）。

## 验收场景

1. server 配置 `agents: ["researcher"]`：主 agent 请求的 tools 数组不含该 server 工具；名为 `researcher` 的子代理 profile 声明 `mcpServers: [<server>]` 后可见并可调用；`general-purpose`（继承模式）不可见。
2. server 配置缺省 `agents`：所有代理可见（回归）。
3. profile 显式 `mcpServers` 声明了拒绝它的 server：子代理启动失败，错误指明被拒 server；声明允许它的 server 正常。
4. SKILL.md 声明 `agents: researcher`：主 agent 与其他子代理的 skill 目录不含该条目；`researcher` 目录含且可加载；带 `agents` 字段的 skill `safeToAutoLoad` 不受影响。
5. UI MCP 设置表单写入 `agents` 后保存 → 配置目录文件 → CLI 文件 schema → session 协议 → runtime 全链路字段不丢。
