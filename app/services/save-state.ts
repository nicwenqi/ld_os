export type SaveState = {
  saving: boolean;
  dirty: boolean;
  error: string | null;
  savedAt: string | null;
};

export type SaveStateKind =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "failed"
  | "conflict";

const conflictPatterns = [
  /已被.+更新/,
  /已更新，请刷新/,
  /刷新后重试/,
  /重新读取/,
  /并发/,
  /\bconflict\b/i,
  /\bstale\b/i,
];

export function isSaveConflict(error: string | null) {
  return Boolean(error && conflictPatterns.some(pattern => pattern.test(error)));
}

export function saveStateKind(state: SaveState): SaveStateKind {
  if (state.saving) return "saving";
  if (isSaveConflict(state.error)) return "conflict";
  if (state.error) return "failed";
  if (state.dirty) return "dirty";
  if (state.savedAt) return "saved";
  return "clean";
}

export function saveStateLabel(state: SaveState) {
  switch (saveStateKind(state)) {
    case "saving":
      return "保存中";
    case "conflict":
      return "保存冲突，请重新读取";
    case "failed":
      return "保存失败，点击重试";
    case "dirty":
      return "有未保存更改";
    case "saved":
      return `已保存 · ${state.savedAt}`;
    default:
      return "未修改";
  }
}
