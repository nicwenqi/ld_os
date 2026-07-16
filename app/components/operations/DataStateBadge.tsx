import type { FoundationPresentationState } from "../../services/foundation-readiness.ts";

type DataState = FoundationPresentationState | "unavailable" | "failed";

const labels: Record<DataState, string> = {
  real: "真实基础数据",
  demo: "本地验证数据",
  partial: "数据不完整",
  unavailable: "尚未接入真实数据",
  failed: "读取失败",
};

export function DataStateBadge({ state }: { state: DataState }) {
  return <span className={`data-state-badge ${state}`}>{labels[state]}</span>;
}
