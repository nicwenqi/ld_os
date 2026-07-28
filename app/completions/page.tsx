import { CompletionWorkspace } from "../components/completion/CompletionWorkspace";
import { ProtectedAppProviders } from "../providers";

export default function CompletionEvidencePage() {
  return (
    <ProtectedAppProviders>
      <CompletionWorkspace mode="manager" />
    </ProtectedAppProviders>
  );
}
