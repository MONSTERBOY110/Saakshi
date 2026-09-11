import { buildInitialSession } from "@/lib/aai/agent-config";
import { Ears } from "@/lib/aai/ears";
import { Mouth } from "@/lib/aai/mouth";
import { createAnalyzerClient, type AnalyzerClient } from "@/lib/analyzer/client";
import { createRouter, type Router } from "@/lib/audio/router";
import { CALIBRATE_PROMPT } from "@/lib/prompts";
import type { CompiledPack } from "@/lib/rules/pack";
import type { RoomController } from "./controller";
import { handleEarsEvent } from "./ears-handler";
import { buildGreeting, buildKeyterms, buildSttPrompt, type SessionSetup } from "./keyterms";
import { audioGates } from "./machine";
import { handleMouthEvent } from "./mouth-handler";

// Builds the moving parts of a session: the audio router with its gates, the analyzer client, and
// the two AssemblyAI clients. Kept out of the controller so the lifecycle reads in one screen.

export function buildRouter(c: RoomController): Router {
  return createRouter({
    gates: () => {
      const gates = audioGates(c.state.phase);
      // Never feed the room back to the agent while it is speaking: the Voice Agent treats
      // incoming speech as barge-in and would cut its own correction short.
      return { ...gates, micToMouth: gates.micToMouth && !c.state.status.agentSpeaking };
    },
    // Judge-solo: the pre-rendered advisor rides along into the Ears and nowhere else.
    nextSynthetic: () => c.judgeSolo?.nextFrame() ?? null,
    sinks: {
      ears: (pcm) => {
        const sent = c.ears?.sendAudio(pcm) ?? false;
        // The server's audio timeline starts at the first frame it actually received, so frames
        // dropped while the socket was opening must not shift the clock.
        if (sent && c.audioClockStart === null) c.audioClockStart = performance.now();
        return sent;
      },
      mouth: (pcm) => c.mouth?.sendAudio(pcm) ?? false,
    },
  });
}

export function buildAnalyzerClient(c: RoomController): AnalyzerClient {
  return createAnalyzerClient({
    // Six a minute fits Groq's free tier with room to spare; the AssemblyAI gateway alone allows two,
    // and a 429 from it parks the client until retry_after, so the higher default is safe either way.
    callsPerMinute: Number(process.env.NEXT_PUBLIC_ANALYZER_RPM ?? 6),
    onResult: (result, request) => c.onAnalysis(result, request),
    onError: (error) => {
      c.log("client", "analyze.error", { error });
      c.set((s) => ({ analyzer: { ...s.analyzer, status: "error", lastError: error } }));
    },
    onSkipped: (reason) => {
      c.log("client", "analyze.skipped", { reason });
      c.set((s) => ({
        analyzer: { ...s.analyzer, status: "skipped", skipped: s.analyzer.skipped + 1 },
      }));
    },
  });
}

export function buildEars(
  c: RoomController,
  setup: SessionSetup,
  pack: CompiledPack,
  sampleRate: number,
): Ears {
  return new Ears({
    mintToken: () => mintToken("/api/token/stt"),
    config: {
      sampleRate,
      keyterms: buildKeyterms(setup, pack),
      prompt: buildSttPrompt(setup, pack),
      languageCodes: ["en", "hi"],
    },
    onEvent: (e) => handleEarsEvent(c, e),
  });
}

export function buildMouth(c: RoomController, setup: SessionSetup, pack: CompiledPack): Mouth {
  return new Mouth({
    mintToken: () => mintToken("/api/token/agent"),
    session: buildInitialSession({
      systemPrompt: CALIBRATE_PROMPT,
      greeting: buildGreeting(setup),
      keyterms: buildKeyterms(setup, pack),
      languageCodes: ["en", "hi"],
    }).session,
    onEvent: (e) => handleMouthEvent(c, e),
  });
}

/** Tokens are minted server-side, single use, and redeemed immediately (CLAUDE.md). */
export async function mintToken(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}
