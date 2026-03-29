"use client";

/** Sovereign, Agentic, Optimized — desktop agent panel header (icons in one row, labels below). */
export function AgentPanelPrinciples() {
  return (
    <div
      className="flex flex-row items-start gap-7 shrink-0"
      role="note"
      aria-label="Product principles"
    >
      <div
        className="flex flex-col items-center gap-1 min-w-0"
        title="Your data and decisions stay under your control."
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center shrink-0">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--accent-green)]"
            aria-hidden
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-green)] leading-tight text-center whitespace-nowrap">
          Sovereign
        </span>
      </div>
      <div
        className="flex flex-col items-center gap-1 min-w-0"
        title="Agents take action; you steer outcomes."
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center shrink-0">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[#5eb0e8]"
            aria-hidden
          >
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#5eb0e8] leading-tight text-center whitespace-nowrap">
          Agentic
        </span>
      </div>
      <div
        className="flex flex-col items-center gap-1 min-w-0"
        title="Tuned for speed, cost, and quality — always improving."
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center shrink-0">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[#c9a227]"
            aria-hidden
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#c9a227] leading-tight text-center whitespace-nowrap">
          Optimized
        </span>
      </div>
    </div>
  );
}
