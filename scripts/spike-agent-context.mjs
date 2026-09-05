// Headless Voice Agent spikes (no browser, no audio):
//   S4  which context-injection form does the next reply.create actually use?
//       A) conversation.message role system   B) conversation.message role user
//       C) system_prompt appendix via session.update   D) several tagged transcript lines, then
//          an instruction to quote the advisor
//   S3  after N ms with no input.audio at all, does reply.create still produce speech?
// Usage: node scripts/spike-agent-context.mjs [idleMs=300000]
// Reads ASSEMBLYAI_API_KEY from the environment or .env. Costs a few cents (agent time only).
import { readFileSync } from "node:fs";

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
const idleMs = Number(process.argv[2] ?? 300_000);

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
let firstAudioAt = null;
let replyCreatedAt = null;
const latencies = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === "reply.audio") {
    if (replyCreatedAt !== null && firstAudioAt === null) {
      firstAudioAt = Date.now();
      latencies.push(firstAudioAt - replyCreatedAt);
    }
  } else if (m.type !== "transcript.agent.delta") {
    log("<-", JSON.stringify(m).slice(0, 240));
  }
  for (const w of [...waiters]) w(m);
});
ws.addEventListener("close", (ev) => log("closed", ev.code, ev.reason));
ws.addEventListener("error", () => log("ws error"));

const send = (m) => {
  ws.send(JSON.stringify(m));
  log("->", JSON.stringify(m).slice(0, 240));
};
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

async function reply(instructions) {
  replyCreatedAt = Date.now();
  firstAudioAt = null;
  send({ type: "reply.create", instructions });
  const t = await waitFor((m) => m.type === "transcript.agent", 25_000);
  await waitFor((m) => m.type === "reply.done", 10_000);
  await sleep(700);
  return t?.text ?? "<no transcript.agent within 25 s>";
}

const BASE_PROMPT =
  "You are Saakshi, a compliance witness. You receive the conversation as system messages tagged ADVISOR or CUSTOMER with timestamps. You do not speak unless you receive instructions. When you speak, say only what the instructions contain, calmly, under 25 words, and stop. Never invent facts. Never use markdown.";

await new Promise((res) => ws.addEventListener("open", res));
send({
  type: "session.update",
  session: {
    system_prompt: BASE_PROMPT,
    greeting: "Ready.",
    input: { format: { encoding: "audio/pcm" }, keyterms: ["Saakshi", "ULIP"] },
    output: { voice: "anna", format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
  },
});
const ready = await waitFor(
  (m) => m.type === "session.ready" || m.type === "session.error",
  15_000,
);
if (!ready || ready.type !== "session.ready") {
  console.error("no session.ready:", ready);
  process.exit(1);
}
// Let the greeting finish.
await waitFor((m) => m.type === "reply.done", 15_000);
await sleep(500);

const results = {};

// A: system-role conversation.message
send({
  type: "conversation.message",
  role: "system",
  content: "[ADVISOR 00:41] The customer policy number is 4471.",
});
await sleep(800);
results.A_system_message = await reply(
  "Repeat the customer policy number you were given, in one short sentence.",
);

// B: user-role conversation.message
send({
  type: "conversation.message",
  role: "user",
  content: "For the record, the customer policy number is 5582.",
});
await sleep(800);
results.B_user_message = await reply(
  "Repeat the customer policy number you were given, in one short sentence.",
);

// C: system_prompt appendix
send({
  type: "session.update",
  session: { system_prompt: `${BASE_PROMPT} Known facts: the customer policy number is 6693.` },
});
await waitFor((m) => m.type === "session.updated", 10_000);
await sleep(500);
results.C_prompt_appendix = await reply(
  "Repeat the customer policy number you were given, in one short sentence.",
);

// D: the OBSERVE pattern, several tagged lines, then ask for a quote
for (const line of [
  "[ADVISOR 00:52] This plan has a five year lock-in and charges are listed in the illustration.",
  "[CUSTOMER 01:03] Isme paisa kab nikal sakti hoon?",
  "[ADVISOR 01:05] Anytime madam, and the returns are guaranteed, twelve percent.",
]) {
  send({ type: "conversation.message", role: "system", content: line });
  await sleep(300);
}
await sleep(800);
results.D_quote_advisor = await reply(
  "Quote the exact words the advisor said about returns, then stop.",
);

// E: same as D but the fact arrives as a user-role line
send({
  type: "conversation.message",
  role: "user",
  content: "[ADVISOR 01:20] The free look period is thirty days.",
});
await sleep(800);
results.E_quote_user_role = await reply(
  "How long is the free look period according to the advisor? One short sentence.",
);

results.latencies_ms = [...latencies];

// S3: idle with no input.audio at all, then ask for a reply.
log(`S3: idling ${idleMs} ms with no input.audio`);
const t0 = Date.now();
const closedDuringIdle = await waitFor(
  (m) => m.type === "session.error" || m.type === "session.ended",
  idleMs,
);
if (closedDuringIdle) {
  results.S3 = { pass: false, event: closedDuringIdle, after_ms: Date.now() - t0 };
} else {
  const text = await reply("Say exactly this and nothing else: Still here after the wait.");
  results.S3 = { pass: /still here after the wait/i.test(text), text, idle_ms: idleMs };
}

send({ type: "session.end" });
await waitFor((m) => m.type === "session.ended", 8_000);
console.log("\n=== RESULTS ===\n" + JSON.stringify(results, null, 2));
process.exit(0);
