"use client";

import { useEffect, useState, type CSSProperties } from "react";

export interface AgentAvatarProps {
  agentId: string;
  name: string;
  color: string;
  /** When set, load this URL; when omitted, uses /api/agent-avatar?id=agentId */
  src?: string | null;
  /** Outer circle sizing (Tailwind classes) */
  circleClassName?: string;
  /** Letter sizing/weight */
  initialClassName?: string;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}

/**
 * Avatar with a colored initial always present under the image. If the URL fails
 * (404, JSON error body, etc.), the image layer is removed so the letter shows.
 */
export default function AgentAvatar({
  agentId,
  name,
  color,
  src,
  circleClassName = "w-10 h-10 min-w-[40px] min-h-[40px]",
  initialClassName = "text-sm font-medium text-white",
  className = "",
  style,
  alt,
}: AgentAvatarProps) {
  const [hideImage, setHideImage] = useState(false);
  const resolved =
    src === null
      ? null
      : (src ?? `/api/agent-avatar?id=${encodeURIComponent(agentId)}`);

  useEffect(() => {
    setHideImage(false);
  }, [resolved]);

  const initial = (name?.trim()?.[0] ?? agentId?.[0] ?? "?").toUpperCase();

  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden flex items-center justify-center ${circleClassName} ${className}`.trim()}
      style={{ position: "relative", overflow: "hidden", borderRadius: "9999px", backgroundColor: color, ...style }}
    >
      <span
        className={`absolute inset-0 flex items-center justify-center z-[1] select-none ${initialClassName}`.trim()}
        aria-hidden
      >
        {initial}
      </span>
      {resolved && !hideImage ? (
        <img
          key={`${agentId}:${resolved}`}
          src={resolved}
          alt={alt ?? name}
          className="absolute inset-0 z-[2] w-full h-full object-cover"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setHideImage(true)}
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </div>
  );
}
