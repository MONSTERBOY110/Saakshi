// Canonical JSON and SHA-256, identical in the browser and on the server (trd.md section 7).
// The certificate is hashed over canonical JSON so that a re-serialisation, a different key order
// or a different runtime can never change the digest.

/** Keys sorted at every depth, no whitespace, array order preserved, UTF-8 text kept as text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = sortDeep(source[key]);
  }
  return out;
}

/**
 * Lower-case hex SHA-256 of the UTF-8 bytes, from Web Crypto in both runtimes. Node has exposed
 * globalThis.crypto since version 19 and this project requires 20, so one implementation covers the
 * browser and the server. There is deliberately no node:crypto fallback: importing it here pulled
 * the module into the client bundle through the room controller and broke the build.
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error("Web Crypto is unavailable; a secure context and Node 20+ are required");
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
