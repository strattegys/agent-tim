import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AGENT_REGISTRY } from "@/lib/agent-registry";
import { MobileCheckInShell } from "@/components/mobile/MobileCheckInShell";

export const dynamic = "force-dynamic";

function MobileFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4 text-sm text-[#8b9bab]">
      Loading…
    </div>
  );
}

export default async function MobileAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  if (!agentId || !AGENT_REGISTRY[agentId]) {
    redirect("/m/suzi");
  }
  return (
    <Suspense fallback={<MobileFallback />}>
      <MobileCheckInShell agentId={agentId} />
    </Suspense>
  );
}
