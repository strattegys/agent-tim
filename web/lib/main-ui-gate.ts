import { redirect } from "next/navigation";
import { isBackendOnlyUiMode } from "@/lib/backend-only-ui";

/** Call at the top of server pages for the main app shell (not needed on /login or /backend-only). */
export function redirectIfBackendOnlyUi(): void {
  if (isBackendOnlyUiMode()) {
    redirect("/backend-only");
  }
}
