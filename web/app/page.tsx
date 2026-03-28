import { Suspense } from "react";
import CommandCentralClient from "./CommandCentralClient";
import { redirectIfBackendOnlyUi } from "@/lib/main-ui-gate";

/** Avoid static prerender + CSR bailout blank shell when the client reads search params. */
export const dynamic = "force-dynamic";

function HomeFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a0f18] text-[#8b9199] text-sm">
      Loading Command Central…
    </div>
  );
}

export default function HomePage() {
  redirectIfBackendOnlyUi();
  return (
    <Suspense fallback={<HomeFallback />}>
      <CommandCentralClient />
    </Suspense>
  );
}
