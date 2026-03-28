import { redirectIfBackendOnlyUi } from "@/lib/main-ui-gate";
import RemindersRedirectClient from "./RemindersRedirectClient";

export const dynamic = "force-dynamic";

export default function RemindersPage() {
  redirectIfBackendOnlyUi();
  return <RemindersRedirectClient />;
}
