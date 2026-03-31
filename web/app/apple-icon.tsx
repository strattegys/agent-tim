import { ImageResponse } from "next/og";

/**
 * PNG home-screen / PWA icon. iOS and many Android installers ignore SVG manifest icons
 * and synthesize a letter from the app name (e.g. "Strattegys" → white "S").
 */
export const runtime = "edge";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

function LocalLetterIcon({
  letters,
  color,
}: {
  letters: string;
  color: string;
}) {
  return (
    <div
      style={{
        width: 512,
        height: 512,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e1621",
        borderRadius: 96,
      }}
    >
      <span
        style={{
          fontSize: 200,
          fontWeight: 800,
          color,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          letterSpacing: "-0.04em",
        }}
      >
        {letters}
      </span>
    </div>
  );
}

/** Production (no LOCAL* label): match app-construction.svg vibe — stripes + warning triangle. */
function ConstructionIcon() {
  const stripeH = 112;
  const seg = 16;
  const stripeW = 432;
  const segW = stripeW / seg;
  return (
    <div
      style={{
        width: 512,
        height: 512,
        display: "flex",
        flexDirection: "column",
        background: "#0e1621",
        borderRadius: 96,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          height: stripeH,
          marginTop: 56,
          marginLeft: 40,
          width: stripeW,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: seg }).map((_, i) => (
          <div
            key={`s-${i}`}
            style={{
              width: segW,
              height: "100%",
              background: i % 2 === 0 ? "#0c0c0c" : "#f0b90b",
            }}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "52px solid transparent",
            borderRight: "52px solid transparent",
            borderBottom: "88px solid #ca8a04",
            marginTop: -20,
          }}
        />
      </div>
    </div>
  );
}

export default function AppleIcon() {
  const label = process.env.NEXT_PUBLIC_CC_RUNTIME_LABEL?.trim().toUpperCase();

  if (label === "LOCALDEV") {
    return new ImageResponse(<LocalLetterIcon letters="CD" color="#f97316" />, {
      ...size,
    });
  }
  if (label === "LOCALPROD") {
    return new ImageResponse(<LocalLetterIcon letters="CC" color="#f5f5f5" />, {
      ...size,
    });
  }

  return new ImageResponse(<ConstructionIcon />, { ...size });
}
