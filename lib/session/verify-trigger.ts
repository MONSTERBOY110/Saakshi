import { normalise } from "@/lib/rules/normalise";

// The spoken cue that ends the pitch (prd.md P0-6): the agent's name plus a verification verb in
// the same turn. Streaming STT has rendered "Saakshi, verify" as "Saakshi. clarify", so the verb
// list is deliberately forgiving.

const NAME = /(saakshi|sakshi|sakshee|shakshi|saksi|sakshy|साक्षी|साक्शी|सक्षी)/u;
const VERB = /(verif|check|clarif|confirm|review|validat)/;

export function isVerifyTrigger(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  return NAME.test(n) && VERB.test(n);
}
