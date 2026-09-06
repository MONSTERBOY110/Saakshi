import loan from "@/packs/loan-kfs-in.json";
import ulip from "@/packs/insurance-ulip-in.json";
import { compilePack, PackSchema, type CompiledPack, type Pack } from "./pack";

// Packs ship with the app as JSON. Validate once at first use so a bad edit fails loudly.
const RAW: Record<string, unknown> = { "insurance-ulip-in": ulip, "loan-kfs-in": loan };
const cache = new Map<string, CompiledPack>();

export const PACK_IDS = Object.keys(RAW);

export function getPack(id: string): CompiledPack {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = RAW[id];
  if (!raw) throw new Error(`unknown pack ${id}`);
  const compiled = compilePack(PackSchema.parse(raw) as Pack);
  cache.set(id, compiled);
  return compiled;
}
