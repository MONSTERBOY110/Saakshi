// Splits test-results/ws-frames.json (written by tests/e2e/dual-session.live.spec.ts) into one
// fixture file per message shape under tests/fixtures/{stt,agent}/. Audio is already stripped by
// the recorder. Existing fixtures are only replaced when the new run captured that shape.
// Usage: node scripts/split-fixtures.mjs [test-results/ws-frames.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = process.argv[2] ?? "test-results/ws-frames.json";
const frames = JSON.parse(readFileSync(input, "utf8"));
const inbound = (socket) => frames.filter((f) => f.socket === socket && f.dir === "in" && f.json);
const outbound = (socket) => frames.filter((f) => f.socket === socket && f.dir === "out" && f.json);

const stt = inbound("stt");
const agent = inbound("agent");
const agentOut = outbound("agent");

const first = (list, pred) => list.find((f) => pred(f.json))?.json;
const ofType = (type) => (j) => j.type === type;

const picks = {
  "stt/begin.json": first(stt, ofType("Begin")),
  "stt/turn-partial.json": first(stt, (j) => j.type === "Turn" && j.end_of_turn === false),
  "stt/turn-final-a.json": first(
    stt,
    (j) => j.type === "Turn" && j.end_of_turn && j.turn_is_formatted && j.speaker_label === "A",
  ),
  "stt/turn-final-b.json": first(
    stt,
    (j) => j.type === "Turn" && j.end_of_turn && j.turn_is_formatted && j.speaker_label === "B",
  ),
  "stt/turn-final-unformatted.json": first(
    stt,
    (j) => j.type === "Turn" && j.end_of_turn && !j.turn_is_formatted,
  ),
  "stt/turn-pending.json": first(stt, (j) => j.type === "Turn" && j.speaker_label === "PENDING"),
  "stt/turn-hindi.json": first(
    stt,
    (j) => j.type === "Turn" && j.end_of_turn && j.turn_is_formatted && j.language_code === "hi",
  ),
  "stt/speaker-revision.json": first(stt, ofType("SpeakerRevision")),
  "stt/heartbeat.json": first(stt, ofType("Heartbeat")),
  "stt/speech-started.json": first(stt, ofType("SpeechStarted")),
  "stt/termination.json": first(stt, ofType("Termination")),
  "agent/session-ready.json": first(agent, ofType("session.ready")),
  "agent/session-updated.json": first(agent, ofType("session.updated")),
  "agent/session-error.json": first(agent, ofType("session.error")),
  "agent/input-speech-started.json": first(agent, ofType("input.speech.started")),
  "agent/input-speech-stopped.json": first(agent, ofType("input.speech.stopped")),
  "agent/transcript-user-delta.json": first(agent, ofType("transcript.user.delta")),
  "agent/transcript-user.json": first(agent, ofType("transcript.user")),
  "agent/reply-started.json": first(agent, ofType("reply.started")),
  "agent/reply-audio.json": first(agent, ofType("reply.audio")),
  "agent/transcript-agent-delta.json": first(agent, ofType("transcript.agent.delta")),
  "agent/transcript-agent.json": first(agent, ofType("transcript.agent")),
  "agent/reply-done-completed.json": first(
    agent,
    (j) => j.type === "reply.done" && j.status === "completed",
  ),
  "agent/reply-done-interrupted.json": first(
    agent,
    (j) => j.type === "reply.done" && j.status === "interrupted",
  ),
  "agent/tool-call.json": first(agent, ofType("tool.call")),
  "agent/session-ended.json": first(agent, ofType("session.ended")),
  "agent/out-session-update.json": first(agentOut, ofType("session.update")),
  "agent/out-reply-create.json": first(agentOut, ofType("reply.create")),
  "agent/out-conversation-message.json": first(agentOut, ofType("conversation.message")),
};

const root = "tests/fixtures";
let written = 0;
const missing = [];
for (const [rel, json] of Object.entries(picks)) {
  const path = join(root, rel);
  if (!json) {
    if (!existsSync(path)) missing.push(rel);
    continue;
  }
  mkdirSync(join(root, rel.split("/")[0]), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  written += 1;
  console.log("wrote", rel);
}
console.log(`\n${written} fixtures written from ${frames.length} frames.`);
if (missing.length) console.log("not captured yet:", missing.join(", "));
