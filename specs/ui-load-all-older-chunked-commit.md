# Spec: 冷打开历史补齐的分批提交

## 背景与实测

宽屏下打开长会话时，turn navigator 目录会触发 `loadAllOlder()` 补齐全量历史
（`ConversationTimeline.tsx` 的 `shouldHydrateConversationTurnNavigatorDirectory` 门控）。
真机实测（CDP 点击→上屏计时 + 100ms 行数采样，2089 parts 会话）：

- 点击 +657ms：首帧上屏 55 行（wire 快照尾窗 `snapshotTailWindowRows: 60`，`core.ts:75`）——首帧不卡
- 点击 +939ms：**单个 1545ms 同步长任务**
- 点击 +2485ms：行数 55 → 829（补齐 commit 完成，与长任务结束点重合）

根因：`conversationProjectionStore.ts` 的 loadAllOlder 把全部补拉页
reverse+flat 后**一次性 setState/notify**，产生巨型渲染任务。

## 规则

- loadAllOlder 的抓取循环不变（rows/range 分页 await，天然让出主线程）。
- **rowsRange 可能无视 limit 单页返回全部行**（真机实测 957 行单页）——分片必须在
  提交侧按行数硬切，不依赖页边界。
- 在"real-user query ≥ 2"的分支，提交从一次性改为**按抓取顺序（新→旧）逐片
  prepend 提交**，每片不超过 `LOAD_ALL_OLDER_COMMIT_ROWS`（150 行）行；片间
  `setTimeout(0)` 让出主线程，使渲染与输入可以插入。
- 每片提交前重验游标不变量：`current.logEpoch === initialLogEpoch` 且
  `current.rows.window[0]?.rowId === expectedHeadRowId`（随每片推进）；不满足即
  走既有 `stale()` 路径，已提交的片保持有效（prepend 单调，不产生部分合并态）。
- **"不足两条 query" 的判定（含 preserveIncompleteLeadingTurn 分支）保持在全部
  页抓取完成后、任何提交之前**——该分支刻意不把完整历史常驻 renderer 投影
  （既有注释的内存决策），分批提交不得绕过它。
- 最终一片提交时置 `loadingOlder: false`；中间片保持 `loadingOlder: true`。
- 返回契约不变：`hydrated / not-enough-queries / stale / retryable-failure` 与
  `turnNavigatorHydrationTerminal` 的写点不变。

## 规则（补充：补齐期间的导航视口测量暂停）

跨 reload 采样实测：分批提交后剩余的最大长任务（~1.2s）由
`getBoundingClientRect` 自耗时主导（窗口内 ~550ms）——补齐期间每次 chunk commit
经 scroll/ResizeObserver 触发 `syncTurnNavigatorViewport`，对 800+ 行 DOM 反复
强制布局。

- `syncTurnNavigatorViewport` 在 `loadingOlder` 为真时跳过逐行测量
  （保留 mask 同步）；补齐结束后由 `useLayoutEffect` 兜底补跑一次，
  导航 rail 高亮不滞留。
- 逐 turn 收窄（virtualizer 数据替代逐行测量）留待本方案验证后按需追加；
  精确跳转测量与合成 scroll 通知保留不动。

## 不变量

- 提交完成后的最终 snapshot 与一次性提交实现逐值一致（行集合与顺序相同）。
- 每片提交自身原子（单 setState），notify 之间 UI 可交互、流式 delta 可插入
  （delta 只追加尾部行，不影响 prepend 游标校验）。
- `seq` 水位不受影响（rows 补齐不改 seq，与现实现一致）。

## 验收场景

1. 2089 parts 会话冷打开：不再出现 >800ms 的单任务；行数曲线呈阶梯递增。
2. 补齐完成后 rows.window 与一次性实现一致；turn navigator 目录可用性不变。
3. 补齐期间到达流式 delta：不触发 stale，最终窗口正确。
4. 不足两条 query 的会话：行为与现实现一致（不常驻完整历史）。
