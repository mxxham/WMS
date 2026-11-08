/**
 * Network-failure translation. When a device has no internet, the browser's
 * fetch fails and the raw wording leaks into the UI wherever `error.message`
 * is shown: "TypeError: Failed to fetch" (Chromium), "TypeError: NetworkError
 * when attempting to fetch resource." (Gecko), "Load failed" (WebKit) or
 * "fetch failed" (undici). `isNetworkError` recognises those, and
 * `offlineFetch` throws one clean Indonesian error in their place.
 *
 * Real SQL/permission/limit errors never match — those keep their own message.
 */
export const NETWORK_MSG = "Periksa jaringan dan internet.";

const NETWORK_RE = /(?:failed to fetch|networkerror when attempting to fetch resource|load failed|fetch failed|err_internet_disconnected|err_name_not_resolved|err_network_changed)/i;

export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const stack = [...walk(e)].map((x) => x.message).join(" ");
  return NETWORK_RE.test(stack);
}

/** supabase-js resolves a thrown fetch failure into its own error objects; the
 *  original TypeError keeps travelling down the `cause` chain, so walk it. */
function* walk(e: Error & { cause?: unknown }): Generator<Error> {
  const seen = new Set<Error>();
  let cur: unknown = e;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    cur = (cur as { cause?: unknown }).cause;
  }
}

/** The friendly error to throw in place of the raw browser one. */
export const netError = (): Error => new Error(NETWORK_MSG);

/**
 * A browser-safe fetch that answers the operator in Indonesian when the device
 * is offline: refuses before the request when `navigator.onLine` is false, and
 * rewrites the thrown failure when the connection dies mid-flight. Used as the
 * Supabase browser client's fetch (every client-side query and auth call) and
 * by the few direct `fetch` calls (labels, bin detail, evidence upload).
 */
export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw netError();
  try {
    return await fetch(input, init);
  } catch (e) {
    if (isNetworkError(e)) throw netError();
    throw e;
  }
}
