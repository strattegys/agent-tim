const CRM_BASE = process.env.TWENTY_CRM_URL || "http://localhost:3000";
const CRM_KEY = process.env.TWENTY_CRM_API_KEY;

export async function crmFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CRM_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CRM API ${res.status}: ${text}`);
  }
  return res.json();
}
