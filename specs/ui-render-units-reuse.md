# Spec: 会话 render units 的逐轮复用构建器

## 背景与问题

`ConversationTimeline` 每帧（投影帧到达或 1s 时钟 tick 都会换掉 `rows` / `liveNowMs`
引用）调用 `buildConversationTurnRenderUnits(rows, options)`，对全部 turn 无条件
物化。Phase 0 基准实测：1200 行 ≈3ms/帧、4800 行 ≈11ms/帧、19200 行 ≈48ms/帧。
流式期间绝大多数 turn 的行引用并没有变化，重算是纯浪费，并连带击穿
`ConversationTurnGroup` 的 memo。

## 规则

- 新增工厂 `createConversationTurnRenderUnitsBuilder()`（`conversationTurnRenderUnits.ts`），
  返回与 `buildConversationTurnRenderUnits` 深度等价的构建函数，内部按 `turnId`
  缓存上一轮物化结果。`buildConversationTurnRenderUnits` 保持为无缓存的参照实现。
- 某一轮复用缓存的充要判据（全部输入）：
  1. 该轮行引用序列逐元素相同（header 与 orderedRows；行对象不可变，内容变化必然换引用）；
  2. 物化期索引相同（preFilterIndex / preFilterTotal，决定物化内部的 isLastTurn 派生）；
  3. `sessionPhase` 相同（resolveTurnRunning / forceOpenHistory 的回退输入）；
  4. 时钟：`nowMs` 只影响 running 轮的工时与状态（`resolveConversationTurnWorkDurationMs`
     与 `resolveSegmentDurationMs` 均以 running 为闸），因此仅当上一轮物化结果
     `isRunning` 为真时才把 `nowMs` 计入判据。
- 索引位移（keptIndex / keptTotal，来自补页前插或 `shouldKeepRenderUnit` 淘汰）不进
  缓存判据：每轮每次构建都重跑 `normalizeRenderUnitPosition`，用 kept 索引重修
  `isLastTurn` / `assistantHistoryDefaultOpen`；其内部已实现「输入不变返回原引用」。
- 全部轮命中且 normalize 全部返回原引用时，返回上一次的输出数组本身（引用稳定），
  使 `ConversationTimeline` 中以 units 数组为依赖的下游 useMemo 全部命中。
- 缓存每轮构建后按本次出现的 turnId 重建（rewind / 分支切换后旧条目自然清除，
  缓存不跨 turn 集合外泄）。
- 所有权不变：数据源仍是会话投影的 `snapshot.rows.window`；构建器不持有会话状态，
  只持有与 turn 输入一一对应的物化缓存。已发布的 unit 对象与行对象绝不被原地修改。

## 不变量

- 任意 (rows, options) 序列下，构建函数输出与 `buildConversationTurnRenderUnits`
  逐值深度等价（测试以参照实现对拍）。
- 时钟 tick 在无 running 轮时不产生任何新对象、不更换输出数组引用。
- 复用不改变 React key 语义（unit.key 恒为 turnId）。

## 验收场景

1. 同一输入重复构建：输出数组与全部 unit 引用相同。
2. 尾部流式行更新：仅受影响 turn 产生新 unit 引用，历史 unit 引用不变。
3. `nowMs` tick：running 轮重建（工时更新），非 running 轮引用不变；无 running 轮时
   整表复用。
4. 前插历史页 / rewind 移除轮 / sessionPhase 变化：输出与参照实现深度等价。
5. 多步混合变更序列：每一步与参照实现深度等价。
