"use client";

import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/rules/engine";
import type { SessionSetup } from "@/lib/session/keyterms";
import type { RolesState } from "@/lib/session/roles";

type Props = {
  roles: RolesState;
  setup: SessionSetup;
  labelsSeen: string[];
  calibrating: boolean;
  onSwap: () => void;
  onAssign: (role: Role, label: string) => void;
};

export function CalibrationBanner({
  roles,
  setup,
  labelsSeen,
  calibrating,
  onSwap,
  onAssign,
}: Props) {
  const waitingFor = !roles.advisor
    ? setup.advisorName
    : !roles.customer
      ? setup.customerName
      : null;
  // Judge-solo starts watching with only the advisor known, so the banner must not claim both are
  // bound while it is still listening for the person in the room.
  const listening = !calibrating && waitingFor !== null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm"
    >
      <div>
        {listening ? (
          <p>
            <span className="font-medium">Listening for {waitingFor}.</span> Say your name once and
            Saakshi will label your turns.
          </p>
        ) : calibrating && waitingFor ? (
          <p>
            <span className="font-medium">Calibrating roles.</span> Waiting for {waitingFor} to say
            their full name.
            {roles.needsManual
              ? " Two answers came from the same voice; assign the roles below."
              : ""}
          </p>
        ) : (
          <p>
            <span className="font-medium">Roles bound.</span> Advisor {setup.advisorName} is speaker{" "}
            {roles.advisor ?? "?"}, customer {setup.customerName} is speaker {roles.customer ?? "?"}
            .
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {labelsSeen.map((label) => (
          <span key={label} className="flex items-center gap-1">
            <span className="text-ink-soft font-mono text-xs">Speaker {label}:</span>
            <Button size="sm" variant="outline" onClick={() => onAssign("advisor", label)}>
              advisor
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAssign("customer", label)}>
              customer
            </Button>
          </span>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={onSwap}
          disabled={!roles.advisor && !roles.customer}
        >
          Swap roles
        </Button>
      </div>
    </div>
  );
}
