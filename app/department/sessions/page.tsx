import { DepartmentSessionWorkspace } from "../../components/training/DepartmentSessionWorkspace";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentSessionsPage() {
  return (
    <ProtectedAppProviders>
      <DepartmentSessionWorkspace />
    </ProtectedAppProviders>
  );
}
