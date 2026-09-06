// Pre-render the synthetic advisor for judge-solo mode (prd.md P0-10, trd.md section 8).
// Opens one throwaway Voice Agent session with the male voice, speaks each line of a pack's
// demo_script verbatim, and writes the raw 24 kHz mono PCM16 to public/demo/advisor/<pack>/<id>.pcm.
//
// Usage: node scripts/render-advisor.mjs [packId=insurance-ulip-in] [voice=george]
// Reads ASSEMBLYAI_API_KEY from the environment or .env. Costs a few cents of agent time.
//
// This is generated speech written to disk, not a recording of anyone, so it does not touch the
// "no audio is ever stored" rule, which is about the conversations Saakshi witnesses.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const KEY = process.env.ASSEMBLYAI_API_KEY ?? env.ASSEMBLYAI_API_KEY;
if (!KEY) throw new Error("ASSEMBLYAI_API_KEY missing");

const packId = process.argv[2] ?? "insurance-ulip-in";
const voice = process.argv[3] ?? "george";
const pack = JSON.parse(readFileSync(join("packs", `${packId}.json`), "utf8"));
const outDir = join("public", "demo", "advisor", packId);
mkdirSync(outDir, { recursive: true });

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(stamp(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tokRes = await fetch(
  "https://agents.assemblyai.com/v1/token?expires_in_seconds=60&max_session_duration_seconds=1800",
  { headers: { Authorization: `Bearer ${KEY}` } },
);
if (!tokRes.ok) throw new Error(`token ${tokRes.status}`);
const { token } = await tokRes.json();

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
let waiters = [];
let chunks = [];
let collecting = false;

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === "reply.audio") {
    if (collecting) chunks.push(Buffer.from(m.data, "base64"));
  } else if (m.type !== "transcript.agent.delta") {
    log("<-", JSON.stringify(m).slice(0, 200));
  }
  for (const w of [...waiters]) w(m);
});
ws.addEventListener("close", (ev) => log("closed", ev.code, ev.reason));
ws.addEventListener("error", () => log("ws error"));

const send = (m) => ws.send(JSON.stringify(m));
const waitFor = (pred, ms) =>
  new Promise((res) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== fn);
      res(null);
    }, ms);
    const fn = (m) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      waiters = waiters.filter((w) => w !== fn);
      res(m);
    };
    waiters.push(fn);
  });

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error("socket error before open")), { once: true });
});

// The greeting is immutable after ready, so it is set to a space: this session exists only to read
// lines on demand and nothing should be spoken before the first one.
send({
  type: "session.update",
  session: {
    system_prompt:
      "You are a voice for rendering scripted lines. Say exactly what you are told, word for word, and nothing else. Never add a greeting, an acknowledgement or a comment.",
    greeting: " ",
    input: { format: { encoding: "audio/pcm" } },
    output: { voice, format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
  },
});
const ready = await waitFor((m) => m.type === "session.ready", 20_000);
if (!ready) throw new Error("session.ready not received");
log("session ready, voice", voice);
// Let the blank greeting pass before the first line, so its audio is not captured.
await sleep(1500);

const written = [];
for (const line of pack.demo_script) {
  chunks = [];
  collecting = true;
  send({ type: "reply.create", instructions: `Say exactly this and nothing else: ${line.text_en}` });
  const spoken = await waitFor((m) => m.type === "transcript.agent", 30_000);
  await waitFor((m) => m.type === "reply.done", 20_000);
  await sleep(400); // the tail of the audio arrives just after reply.done
  collecting = false;

  const pcm = Buffer.concat(chunks);
  if (pcm.length === 0) {
    log(`!! ${line.id} produced no audio`);
    continue;
  }
  const file = join(outDir, `${line.id}.pcm`);
  writeFileSync(file, pcm);
  const seconds = pcm.length / 2 / 24_000;
  written.push({ id: line.id, bytes: pcm.length, seconds: Number(seconds.toFixed(2)) });
  log(`${line.id}: ${pcm.length} bytes, ${seconds.toFixed(2)} s`);
  // Compare what was said with what was asked for; a mismatch means the line needs re-rendering.
  const said = (spoken?.text ?? "").replace(/\s+/g, " ").trim();
  const want = line.text_en.replace(/\s+/g, " ").trim();
  if (normalise(said) !== normalise(want)) log(`   verbatim check failed, said: ${said}`);
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(
    {
      pack_id: packId,
      voice,
      rendered_at: new Date().toISOString(),
      format: { encoding: "pcm_s16le", sample_rate: 24000, channels: 1 },
      lines: written,
    },
    null,
    2,
  ),
);
log(`wrote ${written.length} of ${pack.demo_script.length} lines to ${outDir}`);

send({ type: "session.end" });
await waitFor((m) => m.type === "session.ended", 6000);
ws.close();

function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
