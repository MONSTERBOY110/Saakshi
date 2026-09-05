"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SessionSetup } from "@/lib/session/keyterms";
import { PACK_IDS } from "@/lib/rules/load";

type Props = {
  setup: SessionSetup;
  onChange: (patch: Partial<SessionSetup>) => void;
  onStart: () => void;
  starting: boolean;
};

export function SetupForm({ setup, onChange, onStart, starting }: Props) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Start a witnessed conversation</CardTitle>
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
            onChange={(e) => onChange({ packId: e.target.value })}
            className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
          >
            {PACK_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
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
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
