"use client";

import { useRef, useSyncExternalStore } from "react";
import { SessionController, type SpikeState } from "./session-controller";

export function useDualSession(): { state: SpikeState; controller: SessionController } {
  const ref = useRef<SessionController | null>(null);
  if (ref.current === null) ref.current = new SessionController();
  const controller = ref.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return { state, controller };
}
