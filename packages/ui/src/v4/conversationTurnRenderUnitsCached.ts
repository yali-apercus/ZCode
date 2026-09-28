// 逐轮复用的 render units 构建器，深度等价于 buildConversationTurnRenderUnits。
// 拆出独立文件是因为 conversationTurnRenderUnits.ts 受 max-lines 约束；
// 物化内部函数经显式导出复用，语义必须与参照实现保持一体（@internal，非公共契约）。
//
// 长会话流式期间 rows.window 每帧换新引用，参照实现因此每帧全量物化所有 turn
// （实测 1200 行 ≈3ms/帧、19200 行 ≈48ms/帧），而其中绝大多数轮的行引用没有变化。
// 本工厂按 turnId 缓存上一轮物化结果，仅当某轮的全部真实输入变化时才重新物化：
// 行引用序列、物化期索引、sessionPhase，以及——仅 running 轮——nowMs（规格见
// specs/ui-render-units-reuse.md）。kept 索引位移不进判据：每轮每次都重跑
// normalizeRenderUnitPosition（输入不变时返回原引用），由它重修 isLastTurn 与
// 末段 assistantHistoryDefaultOpen。与参照实现的深度等价由
// packages/ui/test/conversationTurnRenderUnits.test.ts 以对拍守护。
import type { ConversationRow, SessionPhase, TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";
import {
  materializeDraftUnit,
  normalizeRenderUnitPosition,
  groupRowsIntoDrafts,
  shouldKeepRenderUnit,
  type BuildConversationTurnRenderUnitsOptions,
  type ConversationTurnRenderUnit,
} from "@/v4/conversationTurnRenderUnits.js";

interface TurnRenderUnitsCacheEntry {
  header: TurnHeaderRow | undefined;
  orderedRows: readonly ConversationRow[];
  preFilterIndex: number;
  preFilterTotal: number;
  sessionPhase: SessionPhase | undefined;
  // 仅当物化结果 isRunning 时记录参与构建的 nowMs；非 running 轮不依赖时钟
  // （resolveConversationTurnWorkDurationMs / resolveSegmentDurationMs 均以 running 为闸）。
  runningNowMs: number | undefined;
  unit: ConversationTurnRenderUnit;
}

export function createConversationTurnRenderUnitsBuilder(): (
  rows: readonly ConversationRow[],
  options?: BuildConversationTurnRenderUnitsOptions,
) => ConversationTurnRenderUnit[] {
  let cache = new Map<string, TurnRenderUnitsCacheEntry>();
  let lastOutput: ConversationTurnRenderUnit[] | null = null;
  return (rows, options = {}) => {
    const sessionPhase = options.sessionPhase;
    const nowMs = options.nowMs;
    const { drafts } = groupRowsIntoDrafts(rows);

    const nextCache = new Map<string, TurnRenderUnitsCacheEntry>();
    const kept: ConversationTurnRenderUnit[] = [];
    // 全部轮命中且 normalize 全部返回原引用时，输出数组本身也复用上一轮的引用，
    // 使下游以 units 数组为依赖的 useMemo 全部命中。
    let allReused = lastOutput !== null && lastOutput.length === drafts.length;
    for (let index = 0; index < drafts.length; index++) {
      const draft = drafts[index]!;
      const cached = cache.get(draft.turnId);
      let unit: ConversationTurnRenderUnit;
      if (
        cached &&
        cached.header === draft.header &&
        cached.orderedRows.length === draft.orderedRows.length &&
        cached.orderedRows.every((row, rowAt) => row === draft.orderedRows[rowAt]) &&
        cached.preFilterIndex === index &&
        cached.preFilterTotal === drafts.length &&
        cached.sessionPhase === sessionPhase &&
        (cached.unit.isRunning ? cached.runningNowMs === nowMs : true)
      ) {
        unit = cached.unit;
      } else {
        unit = materializeDraftUnit(draft, index, drafts.length, options);
        allReused = false;
      }
      nextCache.set(draft.turnId, {
        header: draft.header,
        orderedRows: draft.orderedRows,
        preFilterIndex: index,
        preFilterTotal: drafts.length,
        sessionPhase,
        runningNowMs: unit.isRunning ? nowMs : undefined,
        unit,
      });
      if (shouldKeepRenderUnit(unit)) kept.push(unit);
    }
    // kept 索引每轮重算：normalize 对「索引与标志都未变」返回原引用，
    // 只有真的发生位移/翻转的轮才产生新对象。
    for (let keptIndex = 0; keptIndex < kept.length; keptIndex++) {
      const unit = normalizeRenderUnitPosition(kept[keptIndex]!, keptIndex, kept.length, options);
      if (unit !== kept[keptIndex]) {
        allReused = false;
        const entry = nextCache.get(unit.turnId);
        if (entry) entry.unit = unit;
        kept[keptIndex] = unit;
      }
    }
    cache = nextCache;
    if (allReused && lastOutput !== null && lastOutput.length === kept.length) {
      return lastOutput;
    }
    lastOutput = kept;
    return kept;
  };
}
