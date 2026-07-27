import { AttendanceWorkspace } from "../../components/attendance/AttendanceWorkspace";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentAttendanceFeedbackPage() {
  return (
    <ProtectedAppProviders>
      <AttendanceWorkspace mode="department" />
    </ProtectedAppProviders>
  );
}
