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
