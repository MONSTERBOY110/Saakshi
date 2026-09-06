import { describe, expect, it } from "vitest";
import {
  assignRole,
  initialRoles,
  observeFinalLabel,
  observeFinalTurn,
  roleOfLabel,
  rolesBound,
  swapRoles,
  whoseName,
  bindKnownSpeaker,
} from "@/lib/session/roles";

describe("role calibration", () => {
  it("binds the advisor to the first labelled final turn and the customer to the next distinct label", () => {
    let s = initialRoles();
    expect(s.step).toBe("advisor");
    let r = observeFinalLabel(s, "A");
    expect(r.bound).toBe("advisor");
    s = r.state;
    expect(s).toMatchObject({ advisor: "A", step: "customer" });
    r = observeFinalLabel(s, "B");
    expect(r.bound).toBe("customer");
    s = r.state;
    expect(s).toMatchObject({ advisor: "A", customer: "B", step: "done" });
    expect(rolesBound(s)).toBe(true);
  });

  it("ignores PENDING and missing labels", () => {
    const s = initialRoles();
    expect(observeFinalLabel(s, "PENDING").state).toEqual(s);
    expect(observeFinalLabel(s, undefined).state).toEqual(s);
  });

  it("counts a repeated advisor label while waiting for the customer and asks for manual help after two", () => {
    let s = observeFinalLabel(initialRoles(), "A").state;
    s = observeFinalLabel(s, "A").state;
    expect(s).toMatchObject({ step: "customer", attempts: 1, needsManual: false });
    s = observeFinalLabel(s, "A").state;
    expect(s).toMatchObject({ attempts: 2, needsManual: true });
    expect(rolesBound(s)).toBe(false);
    // A distinct label still resolves it.
    s = observeFinalLabel(s, "B").state;
    expect(s).toMatchObject({ customer: "B", step: "done", needsManual: false });
  });

  it("does nothing more once bound", () => {
    let s = initialRoles();
    s = observeFinalLabel(s, "A").state;
    s = observeFinalLabel(s, "B").state;
    const r = observeFinalLabel(s, "C");
    expect(r.bound).toBeUndefined();
    expect(r.state).toEqual(s);
  });

  it("swaps labels and reports roles by label", () => {
    let s = initialRoles();
    s = observeFinalLabel(s, "A").state;
    s = observeFinalLabel(s, "B").state;
    expect(roleOfLabel(s, "A")).toBe("advisor");
    expect(roleOfLabel(s, "B")).toBe("customer");
    expect(roleOfLabel(s, "PENDING")).toBeUndefined();
    const swapped = swapRoles(s);
    expect(roleOfLabel(swapped, "A")).toBe("customer");
    expect(roleOfLabel(swapped, "B")).toBe("advisor");
  });

  it("assigns roles manually and clears a label from the other role", () => {
    let s = initialRoles();
    s = assignRole(s, "advisor", "B");
    expect(s).toMatchObject({ advisor: "B", step: "customer" });
    s = assignRole(s, "customer", "B");
    expect(s).toMatchObject({ advisor: undefined, customer: "B" });
    s = assignRole(s, "advisor", "A");
    expect(s).toMatchObject({ advisor: "A", customer: "B", step: "done", needsManual: false });
  });
});

describe("name-aware calibration", () => {
  const names = { advisor: "Rahul", customer: "Mrs. Sharma" };

  it("binds by the spoken name even when the customer speaks first", () => {
    let s = initialRoles();
    let r = observeFinalTurn(s, { label: "A", text: "My name is Mrs. Sharma." }, names);
    expect(r.bound).toBe("customer");
    s = r.state;
    expect(s).toMatchObject({ customer: "A", step: "advisor" });
    r = observeFinalTurn(s, { label: "B", text: "This is a unit-linked insurance plan." }, names);
    expect(r.bound).toBe("advisor");
    expect(r.state).toMatchObject({ advisor: "B", customer: "A", step: "done" });
  });

  it("ignores honorifics and matches Roman Hindi introductions", () => {
    expect(whoseName("Mera naam Sharma hai.", names)).toBe("customer");
    expect(whoseName("Good morning, my name is Rahul, relationship manager.", names)).toBe(
      "advisor",
    );
    expect(whoseName("Good morning Mrs. Sharma, my name is Rahul.", names)).toBeUndefined();
    expect(whoseName("This plan has a lock-in.", names)).toBeUndefined();
  });

  it("does not let one speaker claim both roles", () => {
    let s = observeFinalTurn(
      initialRoles(),
      { label: "A", text: "My name is Rahul." },
      names,
    ).state;
    const r = observeFinalTurn(s, { label: "A", text: "My name is Mrs. Sharma." }, names);
    expect(r.bound).toBeUndefined();
    expect(r.state).toMatchObject({ advisor: "A", attempts: 1 });
    expect(r.state.customer).toBeUndefined();
    s = observeFinalTurn(r.state, { label: "A", text: "Hello again." }, names).state;
    expect(s.needsManual).toBe(true);
  });

  it("skips PENDING turns and stops once bound", () => {
    let s = initialRoles();
    expect(
      observeFinalTurn(s, { label: "PENDING", text: "My name is Rahul." }, names).state,
    ).toEqual(s);
    s = observeFinalTurn(s, { label: "A", text: "My name is Rahul." }, names).state;
    s = observeFinalTurn(s, { label: "B", text: "Mera naam Sharma hai." }, names).state;
    expect(rolesBound(s)).toBe(true);
    expect(observeFinalTurn(s, { label: "C", text: "My name is Rahul." }, names).state).toEqual(s);
  });
});

describe("bindKnownSpeaker", () => {
  it("binds the label to the role the room already knows", () => {
    const out = bindKnownSpeaker(initialRoles(), "A", "advisor");
    expect(out.bound).toBe("advisor");
    expect(out.state.advisor).toBe("A");
  });

  it("binds the other person on their first turn and finishes calibration", () => {
    const first = bindKnownSpeaker(initialRoles(), "A", "advisor");
    const second = bindKnownSpeaker(first.state, "B", "customer");
    expect(second.state).toMatchObject({ advisor: "A", customer: "B", step: "done" });
  });

  it("changes nothing when the same person speaks again", () => {
    const first = bindKnownSpeaker(initialRoles(), "A", "advisor");
    const again = bindKnownSpeaker(first.state, "A", "advisor");
    expect(again.bound).toBeUndefined();
    expect(again.state).toBe(first.state);
  });

  it("never steals a label that is already the other role", () => {
    const first = bindKnownSpeaker(initialRoles(), "A", "advisor");
    // The advisor speaks again but the room thought it was the customer's turn.
    const wrong = bindKnownSpeaker(first.state, "A", "customer");
    expect(wrong.state.advisor).toBe("A");
    expect(wrong.state.customer).toBeUndefined();
  });

  it("ignores a PENDING label, which names nobody", () => {
    const out = bindKnownSpeaker(initialRoles(), "PENDING", "advisor");
    expect(out.state.advisor).toBeUndefined();
  });
});
