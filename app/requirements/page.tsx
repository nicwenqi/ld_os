import { RequirementWorkspace } from "../components/requirements/RequirementWorkspace";
import { ProtectedAppProviders } from "../providers";

export default function RequirementsPage() {
  return (
    <ProtectedAppProviders>
      <RequirementWorkspace />
    </ProtectedAppProviders>
  );
}
