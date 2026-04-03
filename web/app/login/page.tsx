import { auth } from "@/lib/auth";
import { credentialsSignIn } from "./actions";
import { redirect } from "next/navigation";
import {
  getAppBrandTitle,
  getAppHeadline,
  getLocalRuntimeLabel,
  getLoginBadgeLetter,
} from "@/lib/app-brand";
import { isBackendOnlyUiMode, isMobilePublicUiMode } from "@/lib/backend-only-ui";

export default async function LoginPage() {
  if (isBackendOnlyUiMode()) {
    redirect("/backend-only");
  }
  const session = await auth();
  const mobileUi = isMobilePublicUiMode();
  if (session) redirect(mobileUi ? "/m/suzi" : "/");

  const brandTitle = getAppBrandTitle();
  const tagline = getAppHeadline();
  const badgeLetter = getLoginBadgeLetter();
  const label = getLocalRuntimeLabel();
  const badgeTextClass =
    label === "LOCALDEV" || label === "LOCALDEV_MOBILE"
      ? "text-2xl font-bold text-[#f97316]"
      : "text-2xl font-bold text-white";

  return (
    <div className="h-screen flex items-center justify-center bg-[#0e1621]">
      <div className="text-center">
        <div className="mb-6">
          <div className="w-16 h-16 rounded-full bg-[#2b5278] mx-auto flex items-center justify-center mb-4">
            <span className={badgeTextClass}>{badgeLetter}</span>
          </div>
          <h1 className="text-lg sm:text-xl font-semibold text-[#f5f5f5] leading-snug max-w-md mx-auto px-2">
            {brandTitle}
          </h1>
          <p className="text-[13px] text-[#6b8a9e] mt-3 max-w-md mx-auto px-2">{tagline}</p>
        </div>
        <form action={credentialsSignIn}>
          <button
            type="submit"
            className="bg-[#2b5278] hover:bg-[#3a6a96] text-[#f5f5f5] text-[13px] px-6 py-2.5 rounded-lg transition-colors"
          >
            Enter Chat
          </button>
        </form>
      </div>
    </div>
  );
}
