import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACK_INTERVENTION_TOOL } from "@/lib/aai/tools";
import { getPack } from "@/lib/rules/load";
import { emptyBoard, rebuildBoard } from "@/lib/session/board";
import {
  acknowledgeIntervention,
  endIntervention,
  recordInterventionLatency,
  startIntervention,
  startNudge,
} from "@/lib/session/flows";
import type { Intervention } from "@/lib/session/fusion";
import { DEFAULT_SETUP } from "@/lib/session/keyterms";
import { transition, type MachineEvent, type Phase } from "@/lib/session/machine";
import type { StoredTurn } from "@/lib/session/transcript";

// The flows drive a controller-shaped object; this fake records what they asked the room to do.
const pack = getPack("insurance-ulip-in");

function turn(order: number, text: string): StoredTurn {
  return {
    order,
    text,
    final: true,
    formatted: true,
    speakerLabel: "A",
    role: "advisor",
    language: "en",
    startMs: order * 1000,
    endMs: order * 1000 + 800,
    words: [],
    revised: false,
    pending: false,
  };
}

function makeController(phase: Phase = "OBSERVE") {
  const spoken: string[] = [];
  const tools: string[][] = [];
  const logs: Array<{ type: string; payload: unknown }> = [];
  let forceEndpointCalls = 0;
  const state = {
    phase,
    setup: DEFAULT_SETUP,
    board: emptyBoard(pack),
    intervention: undefined as unknown,
    nudge: undefined as unknown,
    interventionLatenciesMs: [] as number[],
    interventionsLog: [] as Array<Record<string, unknown>>,
    transcript: { turns: [] as StoredTurn[] },
  };
  const c = {
    pack,
    state,
    pendingIntervention: null as { key: string; detectedAt: number } | null,
    ackTimer: null as ReturnType<typeof setTimeout> | null,
    mouth: {
      setTools: (t: Array<{ name: string }>) => {
        tools.push(t.map((x) => x.name));
        return true;
      },
    },
    ears: {
      forceEndpoint: () => {
        forceEndpointCalls += 1;
        return true;
      },
    },
    set(patch: Record<string, unknown> | ((s: typeof state) => Record<string, unknown>)) {
      Object.assign(state, typeof patch === "function" ? patch(state) : patch);
    },
    dispatch(event: MachineEvent) {
      const next = transition(state.phase, event);
      if (!next) return false;
      state.phase = next;
      return true;
    },
    speakExact(text: string) {
      spoken.push(text);
    },
    log(_source: string, type: string, payload: unknown) {
      logs.push({ type, payload });
    },
    clearAckTimer() {
      if (this.ackTimer) clearTimeout(this.ackTimer);
      this.ackTimer = null;
    },
  };
  return {
    c: c as never as Parameters<typeof startIntervention>[0],
    state,
    spoken,
    tools,
    logs,
    forceEndpointCalls: () => forceEndpointCalls,
  };
}

const critical: Intervention = {
  id: "guaranteed_returns",
  severity: "critical",
  turnOrder: 9,
  source: "rules",
  quote: "the returns are guaranteed, 12%",
};

beforeEach(() => vi.useFakeTimers());

describe("startIntervention", () => {
  it("moves to INTERVENE, speaks the pack correction and exposes the ack tool", () => {
    const { c, state, spoken, tools } = makeController();
    startIntervention(c, critical, 1000);
    expect(state.phase).toBe("INTERVENE");
    expect(spoken).toEqual([
      "Rahul, a quick flag. Returns on a market-linked plan cannot be called guaranteed. Mrs. Sharma, please note.",
    ]);
    expect(tools).toEqual([["ack_intervention"]]);
    expect(ACK_INTERVENTION_TOOL.execution_mode).toBe("interactive");
    expect(state.intervention).toMatchObject({
      key: "guaranteed_returns@9",
      severity: "critical",
      source: "rules",
      acknowledged: false,
    });
  });

  it("does nothing outside OBSERVE", () => {
    const { c, state, spoken } = makeController("CALIBRATE");
    startIntervention(c, critical, 1000);
    expect(state.phase).toBe("CALIBRATE");
    expect(spoken).toEqual([]);
  });

  it("records the latency from the violating turn to the first agent sound", () => {
    const { c, state } = makeController();
    startIntervention(c, critical, 1000);
    recordInterventionLatency(c, 2834);
    expect(state.interventionLatenciesMs).toEqual([1834]);
    expect((state.intervention as { latencyMs: number }).latencyMs).toBe(1834);
    expect(state.board.violations).toEqual([]); // the board row is created by the rule pass
    // A second call without a new intervention is ignored.
    recordInterventionLatency(c, 9999);
    expect(state.interventionLatenciesMs).toEqual([1834]);
  });

  it("marks the violation acknowledged and returns to OBSERVE", () => {
    const { c, state, tools } = makeController();
    state.board = rebuildBoard(pack, [
      turn(9, "Anytime, madam, and the returns are guaranteed, 12%."),
    ]);
    startIntervention(c, critical, 1000);
    acknowledgeIntervention(c, "sorry, let me correct that", true);
    expect(state.phase).toBe("OBSERVE");
    expect(state.intervention).toBeUndefined();
    expect(state.board.violations.find((v) => v.key === "guaranteed_returns@9")?.status).toBe(
      "acknowledged",
    );
    expect(tools.at(-1)).toEqual([]); // the tool is withdrawn again
  });

  it("returns to OBSERVE on the timeout when nobody acknowledges", () => {
    const { c, state } = makeController();
    startIntervention(c, critical, 1000);
    vi.advanceTimersByTime(12_001);
    expect(state.phase).toBe("OBSERVE");
    expect(state.intervention).toBeUndefined();
  });

  it("ignores a late acknowledgement after the window closed", () => {
    const { c, state } = makeController();
    startIntervention(c, critical, 1000);
    endIntervention(c, "timeout");
    acknowledgeIntervention(c, "too late", true);
    expect(state.phase).toBe("OBSERVE");
  });
});

describe("startNudge", () => {
  it("moves to NUDGE, forces an endpoint, speaks the missing disclosures and marks the board", () => {
    const { c, state, spoken, forceEndpointCalls } = makeController();
    state.board = rebuildBoard(pack, [
      turn(1, "The premium is fifty thousand every year for ten years, policy term fifteen years."),
      turn(2, "There is a five year lock-in and charges apply."),
    ]);
    startNudge(c, "spoken", 3);
    expect(state.phase).toBe("NUDGE");
    expect(forceEndpointCalls()).toBe(1);
    expect(state.board.nudgedAtOrder).toBe(3);
    expect(spoken[0]).toMatch(/^Before we finish, /);
    expect((state.nudge as { missing: string[] }).missing).toContain("free_look_30");
  });

  it("says everything was covered when nothing is missing", () => {
    const { c, state, spoken } = makeController();
    state.board = {
      ...state.board,
      checkpoints: state.board.checkpoints.map((x) => ({ ...x, status: "met" as const })),
    };
    startNudge(c, "button", 10);
    expect(spoken[0]).toBe("Every required disclosure has been covered. Thank you.");
    expect((state.nudge as { missing: string[] }).missing).toEqual([]);
  });

  it("does nothing outside OBSERVE", () => {
    const { c, state, spoken } = makeController("TEACHBACK");
    startNudge(c, "button", 4);
    expect(state.phase).toBe("TEACHBACK");
    expect(spoken).toEqual([]);
  });
});

describe("the intervention record for the certificate", () => {
  it("keeps every intervention after the banner clears", () => {
    const { c, state } = makeController();
    startIntervention(c, critical, 1000);
    acknowledgeIntervention(c, "sorry, let me correct that", true);
    expect(state.intervention).toBeUndefined();
    expect(state.interventionsLog).toHaveLength(1);
    expect(state.interventionsLog[0]).toMatchObject({
      key: "guaranteed_returns@9",
      acknowledged: true,
    });
    expect(String(state.interventionsLog[0]?.spokenText)).toMatch(/guarantee/i);
  });
});
