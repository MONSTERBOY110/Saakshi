import type { AgentToolDefinition } from "./agent-config";

// Client-side Voice Agent tools. Shape verified from the docs on 2026-09-05: type "function",
// JSON-schema parameters, execution_mode interactive or hold, timeout_seconds 1 to 300.
// Tools are for actions the agent must take, never for logging or extraction.

export const ACK_INTERVENTION_TOOL: AgentToolDefinition = {
  type: "function",
  name: "ack_intervention",
  description:
    "Record that the advisor acknowledged the correction Saakshi just spoke. Call once, as soon as the advisor agrees, accepts, apologises or restates the point correctly.",
  parameters: {
    type: "object",
    properties: {
      acknowledged: {
        type: "boolean",
        description:
          "true when the advisor accepted the correction, for example okay, understood, sorry, let me correct that",
      },
      note: {
        type: "string",
        description: "The advisor's words, verbatim, for example: sorry, let me correct that",
      },
    },
    required: ["acknowledged", "note"],
    additionalProperties: false,
  },
  execution_mode: "interactive",
  timeout_seconds: 10,
};

export const RECORD_ANSWER_TOOL: AgentToolDefinition = {
  type: "function",
  name: "record_answer",
  description:
    "Record the customer's answer to the teach-back question you just asked, and judge whether she understood. Call this once, as soon as she has finished answering. Do not call it for the advisor's words, for a question she asks you, or before she has answered.",
  parameters: {
    type: "object",
    properties: {
      question_id: {
        type: "string",
        description:
          "The id of the question you asked, from the numbered list in your instructions",
        examples: ["q1", "q3"],
      },
      verdict: {
        type: "string",
        description:
          "understood when she covered the point in her own words; partial when she got some of it; not_understood when she could not answer or was wrong",
        enum: ["understood", "partial", "not_understood"],
      },
      customer_words: {
        type: "string",
        description:
          "What she actually said, verbatim, in whatever language she used. Never a paraphrase.",
        examples: ["Paanch saal lock hai, uske baad nikal sakti hoon"],
      },
    },
    required: ["question_id", "verdict", "customer_words"],
    additionalProperties: false,
  },
  execution_mode: "interactive",
  timeout_seconds: 10,
};

export const REEXPLAIN_TOOL: AgentToolDefinition = {
  type: "function",
  name: "reexplain",
  description:
    "Say that you are about to explain a point again because the customer's answer was partial or wrong. Call this before you re-explain, then explain in two short sentences and ask the same question once more. Do not call it twice for the same question.",
  parameters: {
    type: "object",
    properties: {
      question_id: {
        type: "string",
        description: "The id of the question being re-explained",
        examples: ["q2"],
      },
      reason: {
        type: "string",
        description: "What she missed, in a few words",
        examples: ["thought the money was available any time"],
      },
    },
    required: ["question_id", "reason"],
    additionalProperties: false,
  },
  execution_mode: "interactive",
  timeout_seconds: 10,
};

// Hold mode: the agent goes quiet while the room writes the certificate, and the tool result
// auto-fires the closing line (docs, Tools overview). Revealed only after three recorded answers.
export const FINISH_TEACHBACK_TOOL: AgentToolDefinition = {
  type: "function",
  name: "finish_teachback",
  description:
    "End the teach-back. Call this only when every question in your instructions has a recorded answer. Do not call it early, and do not call it twice.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One short sentence on how well the customer understood the product",
        examples: ["She understood the lock-in and the charges, and needed the market risk twice"],
      },
    },
    required: ["summary"],
    additionalProperties: false,
  },
  execution_mode: "hold",
  timeout_seconds: 30,
};

export const TEACHBACK_TOOLS: AgentToolDefinition[] = [RECORD_ANSWER_TOOL, REEXPLAIN_TOOL];
export const TEACHBACK_TOOLS_WITH_FINISH: AgentToolDefinition[] = [
  RECORD_ANSWER_TOOL,
  REEXPLAIN_TOOL,
  FINISH_TEACHBACK_TOOL,
];
