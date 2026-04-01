/** @deprecated Use getSidebarHeaderTitle() — label comes from NEXT_PUBLIC_CC_RUNTIME_LABEL. */
export const SIDEBAR_HEADER_TITLE = "Agent Team";

export type LocalRuntimeLabel = "LOCALDEV" | "LOCALPROD";

/** Set by npm scripts / Docker dev: LOCALDEV (port 3010) or LOCALPROD (port 3001). */
export function getLocalRuntimeLabel(): LocalRuntimeLabel | null {
  const v = process.env.NEXT_PUBLIC_CC_RUNTIME_LABEL?.trim().toUpperCase();
  if (v === "LOCALDEV" || v === "LOCALPROD") return v;
  return null;
}

/** Sidebar / mobile agent-list header: LOCALDEV · LOCALPROD, or Agent Team in production. */
export function getSidebarHeaderTitle(): string {
  return getLocalRuntimeLabel() ?? "Agent Team";
}

/** Short tagline (metadata description, login subtitle). */
export function getAppHeadline(): string {
  return "CRM and agent workspace";
}

/**
 * Visible app name (document title, login heading).
 * Production droplet: no NEXT_PUBLIC_CC_RUNTIME_LABEL → "Strattegys Command Central".
 */
export function getAppBrandTitle(): string {
  const label = getLocalRuntimeLabel();
  if (label) {
    return `Strattegys Command Central · ${label}`;
  }
  if (process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1") {
    return "Strattegys Command Central · Local";
  }
  if (process.env.NODE_ENV === "development") {
    return "Strattegys Command Central · Local";
  }
  return "Strattegys Command Central";
}

/** True for LOCALDEV or legacy dev heuristics (PWA / tooling). LOCALPROD uses production NODE_ENV. */
export function isDevAppBranding(): boolean {
  return (
    getLocalRuntimeLabel() === "LOCALDEV" ||
    process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1" ||
    process.env.NODE_ENV === "development"
  );
}

/** Agent header “Dev” toggle (compact layout + log dock). Laptop-local only — not hosted production. */
export function showAgentDevLayoutToggle(): boolean {
  return isDevAppBranding() || getLocalRuntimeLabel() === "LOCALPROD";
}

export function getAppleWebAppShortName(): string {
  const label = getLocalRuntimeLabel();
  if (label) return `CC · ${label}`;
  if (isDevAppBranding()) return "Command Central · Local";
  return "Command Central";
}

/** In-browser tab favicon (SVG is fine in modern desktop Chrome). */
export function getInstallAppIconPath(): string {
  const label = getLocalRuntimeLabel();
  if (label === "LOCALDEV") return "/icons/app-icon-localdev.svg";
  if (label === "LOCALPROD") return "/icons/app-icon-localprod.svg";
  return "/icons/app-construction.svg";
}

/**
 * PWA manifest + installers (iOS / many Android builds) need PNG; they often ignore SVG and
 * show a monogram from the app name instead. Served by `app/apple-icon.tsx`.
 */
export function getPwaManifestIconPath(): string {
  return "/apple-icon";
}

/** Login avatar letters; matches install icon labeling for local builds. */
export function getLoginBadgeLetter(): string {
  const label = getLocalRuntimeLabel();
  if (label === "LOCALDEV") return "CD";
  if (label === "LOCALPROD") return "CC";
  return "S";
}
