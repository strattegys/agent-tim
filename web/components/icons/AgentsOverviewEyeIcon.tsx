/** Overview: agents / system health at a glance. */

export function AgentsOverviewEyeIcon({
  size = 14,
  stroke,
  className,
}: {
  size?: number;
  stroke: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 12s3.5 7 10 7 10-7 10-7-3.5-7-10-7-10 7-10 7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
