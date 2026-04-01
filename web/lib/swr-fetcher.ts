/**
 * Shared JSON fetcher for useSWR hooks.
 * Throws on non-2xx so SWR surfaces the error via `error`.
 */
export async function swrFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
