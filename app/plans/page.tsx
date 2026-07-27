import { TrainingPlanWorkspace } from "../components/training/TrainingPlanWorkspace";
import { ProtectedAppProviders } from "../providers";

export default function TrainingPlansPage() {
  return (
    <ProtectedAppProviders>
      <TrainingPlanWorkspace />
    </ProtectedAppProviders>
  );
}
