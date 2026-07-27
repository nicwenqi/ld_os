import { AttendanceWorkspace } from "../components/attendance/AttendanceWorkspace";
import { ProtectedAppProviders } from "../providers";

export default function AttendanceAndFeedbackPage() {
  return (
    <ProtectedAppProviders>
      <AttendanceWorkspace mode="manager" />
    </ProtectedAppProviders>
  );
}
