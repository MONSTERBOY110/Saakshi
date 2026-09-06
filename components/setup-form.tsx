"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SessionSetup } from "@/lib/session/keyterms";
import { getPack, PACK_IDS } from "@/lib/rules/load";

type Props = {
  setup: SessionSetup;
  onChange: (patch: Partial<SessionSetup>) => void;
  onStart: () => void;
  starting: boolean;
};

export function SetupForm({ setup, onChange, onStart, starting }: Props) {
  return (
    <Card className="card-print max-w-2xl border-[3px] bg-[#fbf6ea]">
      <CardHeader>
        <CardTitle className="font-display text-2xl leading-tight">
          START A WITNESSED CONVERSATION
        </CardTitle>
        <CardDescription>
          Names and product terms become recognition vocabulary for both AssemblyAI sessions.
          Saakshi greets the room, asks each person for their full name, then listens.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Protocol pack" htmlFor="pack">
          <select
            id="pack"
            value={setup.packId}
            onChange={(e) => onChange(switchPack(setup, e.target.value))}
            className="border-ink bg-paper h-9 w-full border-2 px-2 text-sm"
            data-testid="pack-select"
          >
            {PACK_IDS.map((id) => (
              <option key={id} value={id}>
                {getPack(id).title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product name" htmlFor="product">
          <Input
            id="product"
            value={setup.productName}
            onChange={(e) => onChange({ productName: e.target.value })}
          />
        </Field>
        <Field label="Advisor name" htmlFor="advisor">
          <Input
            id="advisor"
            value={setup.advisorName}
            onChange={(e) => onChange({ advisorName: e.target.value })}
          />
        </Field>
        <Field label="Customer name" htmlFor="customer">
          <Input
            id="customer"
            value={setup.customerName}
            onChange={(e) => onChange({ customerName: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Product terms (comma separated, optional)" htmlFor="terms">
            <Input
              id="terms"
              value={setup.productTerms.join(", ")}
              onChange={(e) =>
                onChange({
                  productTerms: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="e.g. SecureGrowth, Balanced Fund"
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="judge-solo" className="flex items-start gap-2 text-sm">
            <input
              id="judge-solo"
              type="checkbox"
              className="mt-0.5"
              checked={setup.judgeSolo}
              onChange={(e) => onChange({ judgeSolo: e.target.checked })}
              data-testid="judge-solo-toggle"
            />
            <span>
              <span className="font-medium">Judge-solo mode</span>
              <span className="text-ink-soft">
                {" "}
                plays the advisor from a recording, so one person can run the whole demo. Turn it
                off when two people are in the room.
              </span>
            </span>
          </label>
        </div>
        <div className="sm:col-span-2">
          <Button
            size="lg"
            onClick={onStart}
            disabled={starting || !setup.advisorName.trim() || !setup.customerName.trim()}
          >
            Start
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Changing the pack changes what is being sold. The product name follows unless the operator has
 * already typed their own, which is theirs to keep.
 */
function switchPack(setup: SessionSetup, packId: string): Partial<SessionSetup> {
  const wasDefault = PACK_IDS.some((id) => getPack(id).product_default === setup.productName);
  return wasDefault
    ? { packId, productName: getPack(packId).product_default }
    : { packId };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-sm">
      <span className="plate text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
