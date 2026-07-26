import { DepartmentRequirementWorkspace } from "../../components/requirements/DepartmentRequirementWorkspace";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentRequirementsPage() {
  return (
    <ProtectedAppProviders>
      <DepartmentRequirementWorkspace />
    </ProtectedAppProviders>
  );
}
