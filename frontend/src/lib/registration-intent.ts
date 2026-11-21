export async function registrationIntent(scope: string, storage?: Pick<Storage, "getItem" | "setItem">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  const key = "sq-registration-v1:" + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  try {
    const previous = storage?.getItem(key);
    if (previous && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous)) return previous;
  } catch { /* Browser storage may be unavailable; the form keeps an in-memory copy. */ }
  const id = crypto.randomUUID();
  try { storage?.setItem(key, id); } catch { /* Keep the same ID in the mounted form. */ }
  return id;
}
