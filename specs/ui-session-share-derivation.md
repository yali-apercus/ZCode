# Spec: SessionPane 分享派生链的按需构建

## 背景与问题

SessionPane 对每帧到达的会话投影帧无条件执行分享派生链：
`buildConversationTurnRenderUnits`（全量 O(N)）→ `buildConversationTurnNavigatorItems`
→ eligible 过滤 → `rowsById` Map 构建。

Phase 0 基准（`packages/ui/bench-phase0.mts`，未入库）实测全量构建成本：
1200 行 ≈ 3ms/帧、4800 行 ≈ 11ms/帧、19200 行 ≈ 48ms/帧，导航项再乘约 0.5×。
流式输出期间 `snapshot.rows.window` 每帧换新引用，上述 useMemo 全部重算；
而非分享状态下这些结果被下游全部丢弃（所有消费点都以 `shareActive` 为渲染前置）。
这是长会话流式 UI 卡顿的已确认成本之一。

## 规则

- 分享派生链（`shareRenderUnits` → `shareItems` → `eligibleShareItems` →
  `eligibleShareRowIds` / `eligibleShareProductTurnIds`）仅在 `shareActive`
  （`shareDraft?.scope === "partial"`）时构建。
- `shareActive` 为假时，各派生值返回模块级稳定空引用（数组 / Set），避免下游
  `useMemo` 与 props 浅比较被新空容器引用反复击穿。
- 所有权不变：唯一数据源仍是会话投影 `snapshot.rows.window`；本规则只裁剪
  派生时机，不引入第二份状态、不改变数据流方向。

## 不变量

- 分享激活（scope=partial）期间，派生结果与原实现逐值一致。
- 非分享状态下渲染输出不变（消费点原本就不渲染这些数据）。

## 验收场景

1. 流式输出且未开分享：Profile 中不再出现分享链路的 `buildConversationTurnRenderUnits`
   与 `buildConversationTurnNavigatorItems` 调用。
2. 打开部分分享选择面板：列表项、eligible 计数、可勾选行与原实现一致。
3. 分享发布 / 取消后回到普通视图：无残留派生状态，计数归零不异常。
