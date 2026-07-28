import { CompletionWorkspace } from "../../components/completion/CompletionWorkspace";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentCompletionEvidencePage() {
  return (
    <ProtectedAppProviders>
      <CompletionWorkspace mode="department" />
    </ProtectedAppProviders>
  );
}
