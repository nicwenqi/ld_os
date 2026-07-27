import { SessionWorkspace } from "../components/training/SessionWorkspace";
import { ProtectedAppProviders } from "../providers";

export default function TrainingSessionsPage() {
  return (
    <ProtectedAppProviders>
      <SessionWorkspace />
    </ProtectedAppProviders>
  );
}
