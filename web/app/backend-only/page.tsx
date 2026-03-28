import { redirect } from "next/navigation";
import { isBackendOnlyUiMode } from "@/lib/backend-only-ui";

export const dynamic = "force-dynamic";

export default async function BackendOnlyLandingPage() {
  if (!isBackendOnlyUiMode()) {
    redirect("/");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#0e1621] px-6 py-12 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-lg font-semibold text-[#f5f5f5]">
          Command Central (server)
        </h1>
        <p className="text-[13px] leading-relaxed text-[#8b9bab]">
          This host runs APIs, scheduled jobs, and webhooks. Use your local Docker
          dev UI for day-to-day work.
        </p>
        <p className="font-mono text-[10px] text-[#5c6d7c] pt-2">
          CC_PUBLIC_APP_UI=backend
        </p>
      </div>
    </main>
  );
}
