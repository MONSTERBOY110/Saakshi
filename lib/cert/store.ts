import "server-only";
import type { Certificate } from "./schema";

// Certificate storage. Upstash Redis over its REST API when the Vercel integration has provided
// credentials, otherwise an in-memory map so the whole flow still works on a laptop with no store
// provisioned (trd.md section 7). Certificates hold quotes and hashes, never audio, and expire.

export const CERTIFICATE_TTL_SECONDS = 90 * 24 * 60 * 60;

export type CertificateStore = {
  readonly kind: "upstash" | "memory";
  put(cert: Certificate): Promise<void>;
  get(id: string): Promise<Certificate | null>;
};

// Route handlers and server components are separate module graphs, so a module-level map would not
// be shared between writing a certificate and rendering its verify page. Anchor it on globalThis.
const globalRef = globalThis as typeof globalThis & {
  __saakshiCertificates?: Map<string, Certificate>;
};
const memory: Map<string, Certificate> = (globalRef.__saakshiCertificates ??= new Map());

export function getCertificateStore(fetchImpl: typeof fetch = fetch): CertificateStore {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return upstashStore(url.replace(/\/$/, ""), token, fetchImpl);
  return memoryStore();
}

export function memoryStore(): CertificateStore {
  return {
    kind: "memory",
    async put(cert) {
      memory.set(cert.id, cert);
    },
    async get(id) {
      return memory.get(id) ?? null;
    },
  };
}

function upstashStore(url: string, token: string, fetchImpl: typeof fetch): CertificateStore {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    kind: "upstash",
    async put(cert) {
      // SET key value EX ttl, sent as a command array so the payload needs no escaping.
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify([
          "SET",
          key(cert.id),
          JSON.stringify(cert),
          "EX",
          String(CERTIFICATE_TTL_SECONDS),
        ]),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`certificate store write failed: ${res.status}`);
    },
    async get(id) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(["GET", key(id)]),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`certificate store read failed: ${res.status}`);
      const body = (await res.json()) as { result?: string | null };
      if (!body.result) return null;
      return JSON.parse(body.result) as Certificate;
    },
  };
}

function key(id: string): string {
  return `cert:${id}`;
}
