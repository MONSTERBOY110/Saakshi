import type { CompiledPack, TeachbackTopic } from "@/lib/rules/pack";
import type { TeachbackQuestion } from "@/lib/teachback/questions";

// Prompts are code (CLAUDE.md): versioned, short, spoken aloud, no markdown, no exclamation marks.
export const TEACHBACK_PROMPT_VERSION = "2026-09-06.2";

/** The question generator (trd.md section 6.3). One call per session. */
export function buildQuestionsSystemPrompt(pack: CompiledPack, topics: TeachbackTopic[]): string {
  return [
    "You write teach-back questions for Saakshi, a compliance witness at the end of a sales conversation.",
    "The customer will answer out loud, in English, Hindi or a mix, so the questions must be easy to say and easy to answer.",
    `Product type: ${pack.title}.`,
    "",
    "Topics, most important first:",
    topics
      .map(
        (t) =>
          `- ${t.id}: ${t.label}. The customer should be able to say: ${t.expected_points.join("; ")}.`,
      )
      .join("\n"),
    "",
    "Rules:",
    "- Write three to five questions, in the topic order given, one topic each.",
    "- Each question is plain spoken English, at most eighteen words, and ends with a question mark.",
    "- The question must never contain its own answer. A customer who only repeats your sentence back has proved nothing.",
    "- Never write the pattern: explain that <answer>. Ask an open question starting with what, how long, how much or what happens.",
    "- Ask the customer to answer in her own words. Never ask a yes or no question.",
    "- Use only what the advisor actually said. Never introduce a number, a rate or a term that is not in the conversation below.",
    "- No markdown, no exclamation marks, no lists inside a question.",
    "- hint_hi is the same question in Hindi, Devanagari or Roman, for the person running the room to read if needed.",
    "",
    "Examples for the market risk topic:",
    "- Good: What happens to your money if the market falls?",
    "- Bad: Please explain in your own words that the value depends on the market.",
    "Examples for the charges topic:",
    "- Good: What charges will be taken out of your premium?",
    "- Bad: Can you explain that the plan has charges which reduce the amount invested?",
    "",
    "Return only the JSON object.",
  ].join("\n");
}

export function buildQuestionsUserContent(input: {
  advisor: string;
  customer: string;
  product: string;
  flagged: string[];
  missing: string[];
  advisorDigest: string;
}): string {
  return JSON.stringify({
    participants: { advisor: input.advisor, customer: input.customer },
    product: input.product,
    flagged_claims: input.flagged,
    disclosures_not_made: input.missing,
    what_the_advisor_said: input.advisorDigest,
  });
}

/**
 * The Voice Agent's system prompt for the teach-back phase (trd.md section 12). The agent asks the
 * questions itself, because the questions are in the prompt and spike S4 proved the prompt is the
 * only context the next reply reads. Its judgement goes into record_answer, so the room never has
 * to parse speech to know how the customer did.
 */
export function buildTeachbackPrompt(input: {
  advisor: string;
  customer: string;
  product: string;
  questions: TeachbackQuestion[];
}): string {
  const list = input.questions.map((q, i) => `${i + 1}. [${q.id}] ${q.question}`).join("\n");
  return [
    `You are Saakshi. ${input.advisor} has finished explaining a ${input.product} to ${input.customer}.`,
    `Your job is to check that ${input.customer} understood it, in her own words.`,
    "",
    "Ask these questions one at a time, in this order, worded exactly as written:",
    list,
    "",
    "How to run it:",
    "- Ask one question, then stop and listen. Never ask two questions in one turn.",
    `- ${input.customer} may answer in English, Hindi or a mix. Understand all three.`,
    "- As soon as she finishes answering, call record_answer with that question id, your verdict and her exact words.",
    "- If her answer is partial or wrong, call reexplain, explain the point in two short sentences, then ask the same question once more. Only once.",
    "- After you have recorded an answer, move straight to the next question.",
    `- Only ${input.customer} answers. If ${input.advisor} answers for her, say one short line asking her to say it in her own words, then ask again.`,
    "",
    "Never say a number, a rate, a period or a product term that is not in the questions above or that you heard in this conversation. If you did not hear it, you do not have it. Do not estimate it and do not say around a number.",
    "No markdown, no exclamation marks, at most 25 words in any reply.",
    "",
    "Example:",
    `You: ${input.questions[0]?.question ?? "What happens to your money if the market falls?"}`,
    `${input.customer}: Matlab market gira to value kam ho jaayegi.`,
    "You: [call record_answer with verdict understood] Thank you. Next question.",
  ].join("\n");
}

/** Appended with the finish tool once three answers are recorded (progressive reveal). */
export const FINISH_TEACHBACK_INSTRUCTION =
  "\n\nEvery question now has an answer on record. When you have asked the last one, call finish_teachback with a one sentence summary, then say nothing further until the room replies.";
