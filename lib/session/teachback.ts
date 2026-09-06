import { BASELINE_TURN_DETECTION, QUESTION_TURN_DETECTION } from "@/lib/aai/agent-config";
import { TEACHBACK_TOOLS, TEACHBACK_TOOLS_WITH_FINISH } from "@/lib/aai/tools";
import { buildTeachbackPrompt, FINISH_TEACHBACK_INSTRUCTION } from "@/lib/prompts/teachback";
import type { RoomController } from "./controller";
import { finalTurns, type StoredTurn } from "./transcript";
import type { TeachbackAnswer, TeachbackQuestion, TeachbackVerdict } from "./store";

// TEACHBACK phase (prd.md P0-7, trd.md section 2). The agent asks the questions itself, because
// they live in its system prompt and spike S4 showed the prompt is the only context a reply reads.
// The room supplies the questions, judges nothing, and records what the agent reports through the
// tools. Every tool call is a state transition, the pattern the Voice Agent tools docs recommend.

/** Answers needed before finish_teachback is revealed to the agent (progressive reveal). */
export const FINISH_AFTER_ANSWERS = 3;
const QUESTIONS_TIMEOUT_MS = 15_000;

export async function startTeachback(c: RoomController): Promise<void> {
  if (!c.dispatch({ type: "NUDGE_DONE" })) return;
  c.set({
    teachback: {
      status: "loading",
      source: "pack",
      questions: [],
      answers: [],
      reexplained: [],
      advisorInterjections: 0,
      finishOffered: false,
    },
  });

  const loaded = await loadQuestions(c);
  // A room that reaches TEACHBACK with no questions has nothing to ask, so it goes straight to the
  // certificate rather than leaving the customer waiting in silence.
  if (loaded.questions.length === 0) {
    c.log("client", "teachback.no_questions", { error: loaded.error });
    c.set((s) => ({ teachback: s.teachback && { ...s.teachback, error: loaded.error } }));
    finishTeachback(c, "No questions were available.", null);
    return;
  }

  c.set((s) => ({
    teachback: s.teachback && {
      ...s.teachback,
      status: "asking",
      questions: loaded.questions,
      source: loaded.source,
      model: loaded.model,
      error: loaded.error,
    },
  }));
  c.log("client", "teachback.questions", {
    source: loaded.source,
    model: loaded.model,
    latency_ms: loaded.latencyMs,
    questions: loaded.questions.map((q) => `${q.id}:${q.topic}`),
  });

  const { setup } = c.state;
  c.mouth?.updateSession({
    system_prompt: buildTeachbackPrompt({
      advisor: setup.advisorName,
      customer: setup.customerName,
      product: setup.productName,
      questions: loaded.questions,
    }),
    tools: TEACHBACK_TOOLS,
  });
  relaxTurnDetection(c);

  const handover = `${setup.customerName}, I will ask you a few short questions to check what you understood.`;
  const first = loaded.questions[0]?.question ?? "";
  c.mouth?.replyCreate(
    `Say exactly this and nothing else first: ${handover} Then ask question one, worded exactly as written. Say nothing after it.`,
  );
  // Both lines will come back through the Ears, where they must not count as evidence.
  c.recentAgentSpeech.push(handover, first);
}

type LoadedQuestions = {
  questions: TeachbackQuestion[];
  source: "llm" | "pack" | "mixed";
  model?: string;
  latencyMs?: number;
  error?: string;
};

async function loadQuestions(c: RoomController): Promise<LoadedQuestions> {
  const { setup, board } = c.state;
  const advisorDigest = finalTurns(c.state.transcript)
    .filter((t) => t.role === "advisor" && !t.echo)
    .map((t) => t.text)
    .join(" ")
    .slice(-5800);
  const body = {
    pack_id: setup.packId,
    context: {
      advisor: setup.advisorName,
      customer: setup.customerName,
      product: setup.productName,
    },
    board: {
      checkpoints: (board?.checkpoints ?? []).map((x) => ({ id: x.id, status: x.status })),
      violations: (board?.violations ?? []).map((v) => ({ id: v.id, label: v.label })),
    },
    advisor_digest: advisorDigest,
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), QUESTIONS_TIMEOUT_MS);
  try {
    const res = await fetch("/api/teachback/questions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`questions responded ${res.status}`);
    const json = (await res.json()) as LoadedQuestions & { latency_ms?: number };
    return { ...json, latencyMs: json.latency_ms };
  } catch (err) {
    return {
      questions: [],
      source: "pack",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** After a question the customer needs room to think (trd.md section 5, gotchas file). */
export function relaxTurnDetection(c: RoomController): void {
  c.mouth?.updateSession({ input: { turn_detection: QUESTION_TURN_DETECTION } });
}

/** Back to conversational endpointing as soon as the customer starts answering. */
export function restoreTurnDetection(c: RoomController): void {
  c.mouth?.updateSession({ input: { turn_detection: BASELINE_TURN_DETECTION } });
}

export function recordAnswer(
  c: RoomController,
  input: { questionId: string; verdict: TeachbackVerdict; customerWords: string },
): { recorded: boolean; reason?: string } {
  const tb = c.state.teachback;
  if (!tb || tb.status !== "asking")
    return { recorded: false, reason: "teach-back is not running" };
  const question = tb.questions.find((q) => q.id === input.questionId);
  if (!question) {
    const ids = tb.questions.map((q) => q.id).join(", ");
    return { recorded: false, reason: `No question with id ${input.questionId}. Ids are: ${ids}.` };
  }
  const existing = tb.answers.find((a) => a.questionId === question.id);
  // A second answer is only expected after a re-explanation; otherwise the agent is repeating itself.
  if (existing && !tb.reexplained.includes(question.id)) {
    return { recorded: false, reason: `${question.id} already has an answer. Ask the next one.` };
  }

  // The customer's own turn is the evidence, not the agent's report of it.
  const turn = latestCustomerTurn(c);
  const answer: TeachbackAnswer = {
    questionId: question.id,
    question: question.question,
    topic: question.topic,
    verdict: input.verdict,
    customerQuote: turn?.text ?? input.customerWords,
    turnOrder: turn?.order,
    evidence: turn
      ? {
          turn_order: turn.order,
          speaker_role: "customer",
          start_ms: turn.startMs,
          end_ms: turn.endMs,
          quote: turn.text,
          language: turn.language ?? "en",
        }
      : undefined,
    reexplained: tb.reexplained.includes(question.id),
  };
  c.log("client", "teachback.answer", {
    question_id: question.id,
    verdict: answer.verdict,
    turn_order: answer.turnOrder,
    agent_words: input.customerWords,
  });
  c.set((s) => ({
    teachback: s.teachback && {
      ...s.teachback,
      answers: [...s.teachback.answers.filter((a) => a.questionId !== question.id), answer],
    },
  }));
  maybeOfferFinish(c);
  return { recorded: true };
}

export function markReexplained(
  c: RoomController,
  questionId: string,
  reason: string,
): { allowed: boolean; note: string } {
  const tb = c.state.teachback;
  if (!tb) return { allowed: false, note: "The teach-back is not running." };
  if (tb.reexplained.includes(questionId)) {
    return { allowed: false, note: `${questionId} was already explained again. Move on.` };
  }
  c.log("client", "teachback.reexplain", { question_id: questionId, reason });
  c.set((s) => ({
    teachback: s.teachback && {
      ...s.teachback,
      reexplained: [...s.teachback.reexplained, questionId],
    },
  }));
  return {
    allowed: true,
    note: "Explain in two short sentences, then ask the same question once.",
  };
}

/** Seconds before Saakshi will ask the advisor a second time to let the customer speak. */
export const ADVISOR_GUARD_COOLDOWN_MS = 15_000;

/**
 * The advisor answering for the customer is not evidence of her understanding (prd.md P0-7). One
 * reminder is a correction; one per sentence is nagging, so a cooldown keeps it to the former.
 */
export function guardAdvisorAnswer(c: RoomController, now = performance.now()): void {
  const { setup } = c.state;
  if (c.lastAdvisorGuardAt !== null && now - c.lastAdvisorGuardAt < ADVISOR_GUARD_COOLDOWN_MS) {
    return;
  }
  c.lastAdvisorGuardAt = now;
  const line = `${setup.advisorName}, please let ${setup.customerName} answer in her own words.`;
  c.log("client", "teachback.advisor_guard", { line });
  c.set((s) => ({
    teachback: s.teachback && {
      ...s.teachback,
      advisorInterjections: s.teachback.advisorInterjections + 1,
    },
  }));
  c.speakExact(line);
}

/**
 * Reveal finish_teachback once three answers are on record, updating the tools and the prompt in
 * the same message: the docs are explicit that a prompt naming a hidden tool underperforms.
 */
function maybeOfferFinish(c: RoomController): void {
  const tb = c.state.teachback;
  if (!tb || tb.finishOffered || tb.answers.length < FINISH_AFTER_ANSWERS) return;
  const { setup } = c.state;
  c.log("client", "teachback.finish_offered", { answers: tb.answers.length });
  c.mouth?.updateSession({
    system_prompt:
      buildTeachbackPrompt({
        advisor: setup.advisorName,
        customer: setup.customerName,
        product: setup.productName,
        questions: tb.questions,
      }) + FINISH_TEACHBACK_INSTRUCTION,
    tools: TEACHBACK_TOOLS_WITH_FINISH,
  });
  c.set((s) => ({ teachback: s.teachback && { ...s.teachback, finishOffered: true } }));
}

/**
 * finish_teachback runs in hold mode, so the agent is silent from here until the tool result goes
 * back. The room uses that silence to write the certificate and hands the closing line over in the
 * result; the result auto-fires the reply, so nothing sends reply.create after it.
 */
export function finishTeachback(c: RoomController, summary: string, callId: string | null): void {
  if (c.state.teachback?.status === "finishing") return;
  c.log("client", "teachback.finish", { summary, answers: c.state.teachback?.answers.length ?? 0 });
  c.set((s) => ({ teachback: s.teachback && { ...s.teachback, status: "finishing", summary } }));
  restoreTurnDetection(c);
  c.dispatch({ type: "TEACHBACK_DONE" });
  void c.certify(callId);
}

function latestCustomerTurn(c: RoomController): StoredTurn | undefined {
  return finalTurns(c.state.transcript)
    .filter((t) => t.role === "customer" && !t.echo)
    .at(-1);
}
