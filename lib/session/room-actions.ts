import type { RoomController } from "./controller";
import { buildKeyterms } from "./keyterms";
import { fixtureExport } from "./log";
import { assignRole, swapRoles, type RolesState } from "./roles";
import type { Role } from "@/lib/rules/engine";
import { reassignRoles } from "./transcript";

// Operator actions from the room UI. Kept beside the controller so the class stays focused on the
// session lifecycle.

/** Swap or hand-assign the speaker labels, then recompute every role and the whole board. */
export function applyRoles(c: RoomController, roles: RolesState, why: string): void {
  c.log("client", "roles", { why, advisor: roles.advisor, customer: roles.customer });
  c.set({ roles });
  c.set((s) => ({ transcript: reassignRoles(s.transcript, c.roleOf) }));
  c.rebuild();
  c.onRolesChanged();
}

export function swapRoleAssignment(c: RoomController): void {
  applyRoles(c, swapRoles(c.state.roles), "swap");
}

export function assignRoleTo(c: RoomController, role: Role, label: string): void {
  applyRoles(c, assignRole(c.state.roles, role, label), `assign ${role}=${label}`);
}

/** Push extra product vocabulary into both sessions mid-conversation (P0-1). */
export function addKeyterms(c: RoomController, terms: string[]): void {
  if (!c.pack) return;
  const setup = { ...c.state.setup, productTerms: [...c.state.setup.productTerms, ...terms] };
  const keyterms = buildKeyterms(setup, c.pack);
  c.set({ setup });
  if (c.ears?.updateConfiguration({ keyterms_prompt: keyterms })) {
    c.log("client", "UpdateConfiguration", { keyterms_prompt: keyterms });
  }
  if (c.mouth?.updateSession({ input: { keyterms } })) {
    c.log("client", "session.update", { input: { keyterms } });
  }
}

/** Download the debug log as a fixture bundle. Audio is already stripped by the log. */
export function exportFixtures(c: RoomController): void {
  const blob = new Blob([JSON.stringify(fixtureExport(c.state.events), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `saakshi-fixtures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
