/**
 * config.js — 三個 HDP(Human Decision Point)設定區塊
 * 這些是 Claude Code 依 prompt 指示先用預設值實作、但保留給你之後調整的項目。
 * 全部都在這個檔案裡,改完存檔重新整理頁面即可生效。
 */
const CONFIG = {
  // ── HDP 1:開格順序揭露模式 ──────────────────────────────
  // 'liveRandom'   → 每次開新格時才即時抽選下一格(預設)
  // 'preShuffled'  → 開局就決定好整個順序佇列,但不對外揭露,依序取用
  // 兩者對觀眾而言「看起來」一樣(順序都不會被提前公開),
  // 差別在於 preShuffled 的順序在遊戲開始當下就已經固定。
  revealMode: 'liveRandom',

  // ── 投票階段時間限制(秒) ─────────────────────────────
  voteDurationSeconds: 15,

  // ── HDP 2:平票規則 ──────────────────────────────────────
  // 'suspended' → 平票時該格永久「懸置」,不寫入 O/X,視覺特殊標示(預設)
  // 'requeue'   → 平票時該格保留原議題,重新排入佇列尾端,稍後再投一次
  // 'random'    → 平票時由系統亂數決定 O 或 X
  tieBreakRule: 'suspended',

  // ── HDP 3:O / X 與正反立場的對應關係 ─────────────────────
  // 'random' → 每則議題開格時隨機決定 O 代表 positiveLabel 或 negativeLabel(預設)
  // 'fixed'  → 固定 O = positiveLabel、X = negativeLabel
  oxMapping: 'random',

  // ── HDP 4:勝負揭曉的視覺語氣 ─────────────────────────────
  // 'flat'         → 低調、近乎冷感的收尾,無音效/彩帶/爽感動畫(預設)
  // 'celebratory'  → 明確的慶祝感(發光、動畫)
  victoryTone: 'flat',
};
