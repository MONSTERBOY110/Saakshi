import { z } from "zod";
import type { BoardState } from "@/lib/session/board";
import type { CompiledPack, TeachbackTopic } from "@/lib/rules/pack";

// Teach-back questions (trd.md section 6.3). Three to five plain spoken questions built from what
// was actually said: topics that were flagged come first, then disclosures the advisor only made
// after the nudge, then the rest. The generated set is validated before it is spoken, and any
// question that fails validation is replaced by the pack's own wording, so the phase never stalls
// and Saakshi never voices a number nobody said.

export const MAX_QUESTION_WORDS = 18;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;

export const QuestionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  question_en: z.string(),
  expected_points: z.array(z.string()),
  hint_hi: z.string(),
});

export const QuestionsSchema = z.object({ questions: z.array(QuestionSchema) });

export type GeneratedQuestion = z.infer<typeof QuestionSchema>;

export type TeachbackQuestion = {
  id: string;
  topic: string;
  question: string;
  expectedPoints: string[];
  hintHi?: string;
  source: "llm" | "pack";
};

export const QUESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "topic", "question_en", "expected_points", "hint_hi"],
        properties: {
          id: { type: "string", description: "q1 to q5, in order" },
          topic: { type: "string", description: "a teach-back topic id from the list" },
          question_en: { type: "string", description: "plain spoken English, at most 18 words" },
          expected_points: { type: "array", items: { type: "string" } },
          hint_hi: { type: "string", description: "the same question in Roman Hindi" },
        },
      },
    },
  },
} as const;

export const QUESTIONS_SHAPE_HINT = JSON.stringify({
  questions: [
    {
      id: "q1",
      topic: "string",
      question_en: "string",
      expected_points: ["string"],
      hint_hi: "string",
    },
  ],
});

/**
 * Which topics matter most for this conversation: anything flagged, then anything disclosed only
 * after the nudge, then anything never disclosed, then the remaining pack topics.
 */
export function prioritiseTopics(pack: CompiledPack, board: BoardState): TeachbackTopic[] {
  const rank = new Map<string, number>();
  const consider = (topicId: string | undefined, score: number) => {
    if (!topicId) return;
    rank.set(topicId, Math.max(rank.get(topicId) ?? 0, score));
  };
  for (const v of board.violations) {
    const checkpoint = pack.checkpoints.find((c) => c.teachback_topic && relatedTopic(v.id, c.id));
    consider(checkpoint?.teachback_topic ?? topicForViolation(v.id), 100);
  }
  for (const c of pack.checkpoints) {
    const state = board.checkpoints.find((x) => x.id === c.id);
    if (!state) continue;
    // A checkpoint never disclosed stays "pending" to the end, so it outranks one met after a nudge.
    if (state.status === "pending") consider(c.teachback_topic, 80);
    else if (state.status === "met_after_nudge") consider(c.teachback_topic, 60);
    else consider(c.teachback_topic, 20);
  }
  return [...pack.teachback_topics].sort((a, b) => (rank.get(b.id) ?? 10) - (rank.get(a.id) ?? 10));
}

/** The pack's own wording, used as a fallback and as the shape the model is asked to follow. */
export function fallbackQuestions(pack: CompiledPack, board: BoardState): TeachbackQuestion[] {
  return prioritiseTopics(pack, board)
    .slice(0, 4)
    .map((topic, i) => ({
      id: `q${i + 1}`,
      topic: topic.id,
      question: packQuestion(topic),
      expectedPoints: topic.expected_points,
      hintHi: topic.hint_hi,
      source: "pack" as const,
    }));
}

export type ValidationContext = {
  pack: CompiledPack;
  board: BoardState;
  /** Everything the advisor actually said, for the number check. */
  spokenText: string;
};

/**
 * Accept a generated question only if it is speakable, short, on a known topic, genuinely asks
 * rather than tells, and is free of any number that was never said in the conversation.
 */
export function validateQuestion(q: GeneratedQuestion, ctx: ValidationContext): boolean {
  const text = q.question_en?.trim() ?? "";
  if (!text || text.split(/\s+/).length > MAX_QUESTION_WORDS) return false;
  if (!text.endsWith("?")) return false;
  if (/[!*_#`]/.test(text)) return false;
  if (isLeadingQuestion(text)) return false;
  if (!ctx.pack.teachback_topics.some((t) => t.id === q.topic)) return false;
  const spoken = spokenNumbers(ctx.spokenText);
  for (const n of text.match(/\d+/g) ?? []) {
    if (!spoken.has(n)) return false;
  }
  return true;
}

/**
 * A teach-back question that contains its own answer proves nothing. Models drift into
 * "Explain in your own words that the value depends on the market", which the customer can pass by
 * repeating the sentence back. The tell is an instruction verb followed by "that" and the answer.
 * Rejecting a borderline question costs only the pack's plainer wording, so the rule leans strict.
 */
export function isLeadingQuestion(text: string): boolean {
  return /\b(explain|describe|tell me|state|confirm|say)\b[^?]*\bthat\b/i.test(text);
}

/**
 * Numbers the room actually heard, whether written as digits or spoken as words in English or
 * Roman Hindi. "five year lock-in" and "5 years" are the same number to a listener, so a question
 * may say either; a number from neither source is a fabrication and the question is dropped.
 */
export function spokenNumbers(text: string): Set<string> {
  const found = new Set(text.match(/\d+/g) ?? []);
  const words: Record<string, string> = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    fifteen: "15",
    twenty: "20",
    thirty: "30",
    forty: "40",
    fifty: "50",
    sixty: "60",
    hundred: "100",
    ek: "1",
    do: "2",
    teen: "3",
    chaar: "4",
    char: "4",
    paanch: "5",
    panch: "5",
    chhe: "6",
    saat: "7",
    aath: "8",
    nau: "9",
    das: "10",
    baarah: "12",
    barah: "12",
    pandrah: "15",
    bees: "20",
    tees: "30",
    pachaas: "50",
  };
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const digit = words[word];
    if (digit) found.add(digit);
  }
  return found;
}

/** Keep the valid generated questions, then top up from the pack, three to five in total. */
export function mergeQuestions(
  generated: GeneratedQuestion[],
  ctx: ValidationContext,
): TeachbackQuestion[] {
  const kept: TeachbackQuestion[] = [];
  const seenTopics = new Set<string>();
  for (const q of generated) {
    if (kept.length >= MAX_QUESTIONS) break;
    if (!validateQuestion(q, ctx) || seenTopics.has(q.topic)) continue;
    seenTopics.add(q.topic);
    kept.push({
      id: `q${kept.length + 1}`,
      topic: q.topic,
      question: q.question_en.trim(),
      expectedPoints: q.expected_points,
      hintHi: q.hint_hi,
      source: "llm",
    });
  }
  for (const fb of fallbackQuestions(ctx.pack, ctx.board)) {
    if (kept.length >= MIN_QUESTIONS) break;
    if (seenTopics.has(fb.topic)) continue;
    seenTopics.add(fb.topic);
    kept.push({ ...fb, id: `q${kept.length + 1}` });
  }
  return kept.slice(0, MAX_QUESTIONS);
}

function packQuestion(topic: TeachbackTopic): string {
  const byTopic: Record<string, string> = {
    lock_in: "In your own words, for how long is your money locked in?",
    charges: "What charges will be taken from your premium?",
    market_risk: "What happens to your money if the market falls?",
    free_look: "How long do you have to return the policy if you change your mind?",
    premium_term: "How much do you pay each year, and for how many years?",
    surrender_value: "What would you get back if you stopped the policy early?",
    benefit_illustration: "Are the illustrated returns a promise or an assumption?",
  };
  return byTopic[topic.id] ?? `In your own words, what did you understand about ${topic.label}?`;
}

function topicForViolation(id: string): string | undefined {
  const map: Record<string, string> = {
    guaranteed_returns: "market_risk",
    like_fd: "market_risk",
    no_charges: "charges",
    withdraw_anytime: "lock_in",
    tax_free_forever: "charges",
    pressure: "free_look",
  };
  return map[id];
}

function relatedTopic(violationId: string, checkpointId: string): boolean {
  const map: Record<string, string> = {
    guaranteed_returns: "market_risk",
    like_fd: "market_risk",
    no_charges: "charges",
    withdraw_anytime: "lock_in_5y",
    tax_free_forever: "charges",
    pressure: "free_look_30",
  };
  return map[violationId] === checkpointId;
}
