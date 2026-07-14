export type SaveState={saving:boolean;dirty:boolean;error:string|null;savedAt:string|null};
export function saveStateLabel(state:SaveState){if(state.saving)return"保存中";if(state.error)return"保存失败，点击重试";if(state.dirty)return"有未保存更改";if(state.savedAt)return`已保存 · ${state.savedAt}`;return"未修改"}
