import nextDynamic from "next/dynamic";
import { Suspense } from "react";
import {
  redirectIfBackendOnlyUi,
  redirectIfMobileUiInsteadOfDesktopHome,
} from "@/lib/main-ui-gate";

/** Avoid static prerender + CSR bailout blank shell when the client reads search params. */
export const dynamic = "force-dynamic";

function HomeFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a0f18] text-[#8b9199] text-sm">
      Loading Command Central…
    </div>
  );
}

/** Separate async chunk so dev does not time out compiling one giant `app/page.js` bundle. */
const CommandCentralClient = nextDynamic(() => import("./CommandCentralClient"), {
  loading: () => <HomeFallback />,
});

export default function HomePage() {
  redirectIfMobileUiInsteadOfDesktopHome();
  redirectIfBackendOnlyUi();
  return (
    <Suspense fallback={<HomeFallback />}>
      <CommandCentralClient />
    </Suspense>
  );
}
