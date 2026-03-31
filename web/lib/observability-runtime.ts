/**
 * In-process overrides for debug / logging env flags. Lets the Observation Post (and API)
 * toggle behavior without editing .env or restarting. Unset override → fall back to process.env.
 *
 * Stored on `globalThis` so Next.js dev HMR (module reload) does not wipe overrides — module-level
 * `let` would reset while the UI still shows "on", and Groq chat would stop logging to the dock.
 *
 * Scoped to this Node process only (lost on full restart; in serverless, per instance).
 */

export type ObservabilityToggleKey = "GROQ_CHAT_DEBUG" | "TIM_CHAT_CONTEXT_DEBUG";

const TOGGLE_KEYS: ObservabilityToggleKey[] = ["GROQ_CHAT_DEBUG", "TIM_CHAT_CONTEXT_DEBUG"];

const GLOBAL_OVERRIDES_KEY = "__ccObservabilityToggleOverrides" as const;

function getOverrideStore(): Partial<Record<ObservabilityToggleKey, boolean>> {
  const g = globalThis as unknown as Record<string, Partial<Record<ObservabilityToggleKey, boolean>>>;
  if (!g[GLOBAL_OVERRIDES_KEY]) {
    g[GLOBAL_OVERRIDES_KEY] = {};
  }
  return g[GLOBAL_OVERRIDES_KEY]!;
}

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getObservabilityToggleEffective(key: ObservabilityToggleKey): boolean {
  const overrides = getOverrideStore();
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return Boolean(overrides[key]);
  }
  return envTruthy(key);
}

export function setObservabilityToggle(key: ObservabilityToggleKey, value: boolean | null): void {
  const overrides = getOverrideStore();
  if (value === null) {
    delete overrides[key];
  } else {
    overrides[key] = value;
  }
}

export type ObservabilityToggleRow = {
  key: ObservabilityToggleKey;
  label: string;
  description: string;
  envOn: boolean;
  override: boolean | null;
  effective: boolean;
};

export function getObservabilityToggleRows(): ObservabilityToggleRow[] {
  const meta: Record<ObservabilityToggleKey, { label: string; description: string }> = {
    GROQ_CHAT_DEBUG: {
      label: "Groq chat debug",
      description:
        "Log each Groq request/response to server stdout ([groq-debug]). May include CRM/thread text — avoid on shared production.",
    },
    TIM_CHAT_CONTEXT_DEBUG: {
      label: "Tim context debug",
      description:
        "Stream merged work-queue + UI context into chat as “Context debug” (Tim only). Sensitive — dev/testing only.",
    },
  };

  const store = getOverrideStore();
  return TOGGLE_KEYS.map((key) => ({
    key,
    label: meta[key].label,
    description: meta[key].description,
    envOn: envTruthy(key),
    override: Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null,
    effective: getObservabilityToggleEffective(key),
  }));
}
