// conversationTurnRenderUnits builder 的复用与等价性测试。
// 参照实现：buildConversationTurnRenderUnits（无缓存）；被测对象：
// createConversationTurnRenderUnitsBuilder（逐轮复用，specs/ui-render-units-reuse.md）。
import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.js";
import { createConversationTurnRenderUnitsBuilder } from "../src/v4/conversationTurnRenderUnitsCached.js";

let nextRowId = 1;

function headerRow(
  turnId: string,
  state: "running" | "completedSuccess" = "completedSuccess",
): ConversationRow {
  return {
    rowId: nextRowId++,
    turnId,
    kind: "turnHeader",
    origin: "userInput",
    executionKind: "agent",
    state,
    startedAt: 1000,
    createdAt: 1000,
    createdAtSeq: 0,
  } as unknown as ConversationRow;
}

function userRow(turnId: string, text = "hi"): ConversationRow {
  return {
    rowId: nextRowId++,
    turnId,
    kind: "userInput",
    origin: "realUser",
    text,
    createdAt: 1000,
    createdAtSeq: 0,
  } as unknown as ConversationRow;
}

function assistantRow(
  turnId: string,
  text: string,
  state: "streaming" | "complete" = "complete",
): ConversationRow {
  return {
    rowId: nextRowId++,
    turnId,
    kind: "assistantText",
    text,
    state,
    createdAt: 1000,
    createdAtSeq: 0,
  } as unknown as ConversationRow;
}

function appendText(row: ConversationRow, append: string): ConversationRow {
  assert.equal(row.kind, "assistantText");
  return { ...(row as { text: string }), text: (row as { text: string }).text + append };
}

const COMPLETED_TURN = (): ConversationRow[] => [
  headerRow("history"),
  userRow("history"),
  assistantRow("history", "done answer"),
];

test("同一输入重复构建返回同一数组与同一 unit 引用", () => {
  const rows = [
    ...COMPLETED_TURN(),
    headerRow("tail", "running"),
    userRow("tail"),
    assistantRow("tail", "streaming…", "streaming"),
  ];
  const build = createConversationTurnRenderUnitsBuilder();
  const options = { nowMs: 1000, sessionPhase: "running" as const };
  const first = build(rows, options);
  const again = build(rows, options);
  assert.equal(again, first);
  assert.deepEqual(first, buildConversationTurnRenderUnits(rows, options));
});

test("尾部流式更新只重建受影响轮，历史 unit 引用不变", () => {
  const history = COMPLETED_TURN();
  const tail = [
    headerRow("tail", "running"),
    userRow("tail"),
    assistantRow("tail", "a", "streaming"),
  ];
  const rows = [...history, ...tail];
  const build = createConversationTurnRenderUnitsBuilder();
  const options = { nowMs: 1000, sessionPhase: "running" as const };
  const first = build(rows, options);
  const rowsNext = [...history, ...tail.slice(0, 2), appendText(tail[2]!, " more")];
  const second = build(rowsNext, options);
  assert.equal(second.length, first.length);
  assert.equal(second[0], first[0], "未变化轮必须复用同一 unit 引用");
  assert.notEqual(second[1], first[1], "流式轮应产生新 unit 引用");
  assert.deepEqual(second, buildConversationTurnRenderUnits(rowsNext, options));
});

test("无 running 轮时时钟 tick 整表复用（同一数组引用）", () => {
  const rows = COMPLETED_TURN();
  const build = createConversationTurnRenderUnitsBuilder();
  const first = build(rows, { nowMs: 1000, sessionPhase: "running" });
  const ticked = build(rows, { nowMs: 60_000, sessionPhase: "running" });
  assert.equal(ticked, first, "时钟只影响 running 轮，非 running 轮整表复用");
});

test("sessionPhase 变化触发重建且与参照实现等价", () => {
  const rows = COMPLETED_TURN();
  const build = createConversationTurnRenderUnitsBuilder();
  const first = build(rows, { nowMs: 1000, sessionPhase: "running" });
  const second = build(rows, { nowMs: 1000, sessionPhase: "completedSuccess" });
  assert.notEqual(second, first);
  assert.deepEqual(
    second,
    buildConversationTurnRenderUnits(rows, {
      nowMs: 1000,
      sessionPhase: "completedSuccess",
    }),
  );
});

test("running 轮工时随时钟更新，历史轮引用不变", () => {
  const rows = [
    ...COMPLETED_TURN(),
    headerRow("tail", "running"),
    userRow("tail"),
    assistantRow("tail", "streaming…", "streaming"),
  ];
  const build = createConversationTurnRenderUnitsBuilder();
  const first = build(rows, { nowMs: 1000, sessionPhase: "running" });
  const second = build(rows, { nowMs: 5000, sessionPhase: "running" });
  assert.equal(second[0], first[0], "非 running 轮不受时钟影响");
  assert.notEqual(second[1], first[1], "running 轮应随时钟重建");
  const segment = second[1]!.workSegments?.at(-1);
  assert.equal(segment?.workStatus?.durationMs, 4000);
  assert.deepEqual(
    second,
    buildConversationTurnRenderUnits(rows, {
      nowMs: 5000,
      sessionPhase: "running",
    }),
  );
});

test("前插历史页后与参照实现深度等价（kept 索引位移）", () => {
  const tail = [
    headerRow("tail", "running"),
    userRow("tail"),
    assistantRow("tail", "streaming…", "streaming"),
  ];
  const build = createConversationTurnRenderUnitsBuilder();
  const options = { nowMs: 5000, sessionPhase: "running" as const };
  build(tail, options);
  const older = COMPLETED_TURN();
  const rows = [...older, ...tail];
  const output = build(rows, options);
  assert.deepEqual(output, buildConversationTurnRenderUnits(rows, options));
  assert.equal(output.length, 2);
  assert.equal(output[0]!.isLastTurn, false);
  assert.equal(output[1]!.isLastTurn, true);
});

test("rewind 移除尾部轮后与参照实现等价且缓存收敛", () => {
  const rows = [
    ...COMPLETED_TURN(),
    headerRow("tail", "running"),
    userRow("tail"),
    assistantRow("tail", "x", "streaming"),
  ];
  const build = createConversationTurnRenderUnitsBuilder();
  const options = { nowMs: 5000, sessionPhase: "running" as const };
  build(rows, options);
  const rewound = rows.slice(0, 3);
  const first = build(rewound, options);
  assert.deepEqual(first, buildConversationTurnRenderUnits(rewound, options));
  const second = build(rewound, options);
  assert.equal(second, first, "rewind 后缓存应收敛到现存 turn 集合");
});

test("混合变更序列每一步都与参照实现深度等价", () => {
  const build = createConversationTurnRenderUnitsBuilder();
  let rows: ConversationRow[] = [
    headerRow("t1", "running"),
    userRow("t1"),
    assistantRow("t1", "seed", "streaming"),
  ];
  const steps: Array<{
    rows: ConversationRow[];
    options: { nowMs: number; sessionPhase: "running" | "completedSuccess" };
  }> = [{ rows, options: { nowMs: 1000, sessionPhase: "running" } }];
  rows = [
    ...rows,
    headerRow("t2", "running"),
    userRow("t2"),
    assistantRow("t2", "go", "streaming"),
  ];
  steps.push({ rows, options: { nowMs: 2000, sessionPhase: "running" } });
  rows = [...rows.slice(0, 5), appendText(rows[5]!, "!!")];
  steps.push({ rows, options: { nowMs: 3000, sessionPhase: "running" } });
  rows = [
    ...rows.slice(0, 3),
    { ...rows[3]!, state: "completedSuccess" } as ConversationRow,
    rows[4]!,
    { ...(rows[5] as { state: string }), state: "complete" } as unknown as ConversationRow,
  ];
  steps.push({ rows, options: { nowMs: 3100, sessionPhase: "running" } });
  steps.push({ rows, options: { nowMs: 9999, sessionPhase: "running" } });
  rows = [
    ...rows,
    headerRow("t3", "running"),
    userRow("t3"),
    assistantRow("t3", "next", "streaming"),
  ];
  steps.push({ rows, options: { nowMs: 10_000, sessionPhase: "running" } });
  steps.push({ rows, options: { nowMs: 10_000, sessionPhase: "completedSuccess" } });
  rows = [...rows.slice(0, 6), ...rows.slice(9)];
  steps.push({ rows, options: { nowMs: 10_000, sessionPhase: "completedSuccess" } });
  for (const [index, step] of steps.entries()) {
    const actual = build(step.rows, step.options);
    const expected = buildConversationTurnRenderUnits(step.rows, step.options);
    assert.deepEqual(actual, expected, `step ${index} 输出必须与参照实现深度等价`);
  }
});
