import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/lib/cert/canonical";

describe("canonicalJson", () => {
  it("sorts keys at every depth and emits no whitespace", () => {
    const json = canonicalJson({ b: 1, a: { d: [3, { f: 6, e: 5 }], c: 2 } });
    expect(json).toBe('{"a":{"c":2,"d":[3,{"e":5,"f":6}]},"b":1}');
  });

  it("produces the same string whatever order the keys were written in", () => {
    const one = canonicalJson({ id: "x", pack: { version: "1.0.0", id: "p" }, n: 2 });
    const two = canonicalJson({ n: 2, pack: { id: "p", version: "1.0.0" }, id: "x" });
    expect(one).toBe(two);
  });

  it("keeps array order, which carries meaning in the turn digest", () => {
    expect(canonicalJson([{ b: 1 }, { a: 2 }])).toBe('[{"b":1},{"a":2}]');
  });

  it("drops undefined members the way JSON does and keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it("preserves non-ASCII text so Devanagari quotes hash consistently", () => {
    const json = canonicalJson({ quote: "पाँच साल" });
    expect(json).toBe('{"quote":"पाँच साल"}');
    expect(JSON.parse(json).quote).toBe("पाँच साल");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of an empty string", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known digest of abc", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes UTF-8 bytes, so Devanagari has a stable digest", async () => {
    await expect(sha256Hex("पाँच")).resolves.toMatch(/^[0-9a-f]{64}$/);
    const a = await sha256Hex("पाँच");
    const b = await sha256Hex("पाँच".normalize("NFC"));
    expect(a).toBe(b);
  });

  it("returns lower-case hex and changes completely on a one-character edit", async () => {
    const a = await sha256Hex("There is a five year lock-in.");
    const b = await sha256Hex("There is a four year lock-in.");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
