"use client";

import { getAgentSpec } from "@/lib/agent-registry";

export function MobileGenericReadonly({ agentId }: { agentId: string }) {
  const spec = getAgentSpec(agentId);

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-[#0e1621] p-4">
      <h2 className="text-lg font-semibold text-[#f5f5f5]">{spec.name}</h2>
      <p className="text-xs text-[#8b9bab]">{spec.role}</p>
      <p className="text-sm leading-relaxed text-[#b8c0c8]">{spec.description}</p>
      <p className="text-[11px] text-[#6b8a9e]">
        Mobile check-in does not include a detailed board for this agent yet. Use Command Central
        on desktop (port 3010) for full tools.
      </p>
      {spec.capabilities.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5c6d7c]">
            Capabilities
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-[#9ca3af]">
            {spec.capabilities.slice(0, 8).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
