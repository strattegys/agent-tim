import { redirect } from "next/navigation";
import { isBackendOnlyUiMode, isMobilePublicUiMode } from "@/lib/backend-only-ui";

/** Call at the top of server pages for the main app shell (not needed on /login or /backend-only). */
export function redirectIfBackendOnlyUi(): void {
  if (isBackendOnlyUiMode()) {
    redirect("/backend-only");
  }
}

/**
 * When `CC_PUBLIC_APP_UI=mobile`, the desktop home shell is not used; send users to the mobile app.
 */
export function redirectIfMobileUiInsteadOfDesktopHome(): void {
  if (isMobilePublicUiMode()) {
    redirect("/m/suzi");
  }
}
