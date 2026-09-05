"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SpikeState } from "@/lib/spike/session-controller";

type Props = {
  disabled: boolean;
  verbatim: SpikeState["verbatim"];
  onReplyNow: (instructions: string) => void;
  onInjectFact: (fact: string) => void;
  onForceEndpoint: () => void;
  onUpdateKeyterms: (terms: string[]) => void;
  onVerbatimTrial: (n: number) => void;
};

const DEFAULT_REPLY = "Say exactly this and nothing else: I am still here and listening.";
const DEFAULT_FACT = "The customer policy number is 4471.";
const REPEAT_FACT = "Repeat the customer policy number you were given, in one short sentence.";

export function SpikeControls(p: Props) {
  const [reply, setReply] = useState(DEFAULT_REPLY);
  const [fact, setFact] = useState(DEFAULT_FACT);
  const [keyterms, setKeyterms] = useState("Mrs. Sharma, benefit illustration, NAV");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spike controls</CardTitle>
        <CardDescription>
          S3 reply after silence, S4 context injection, S5 verbatim speech, keyterm updates,
          ForceEndpoint. Results land in the debug drawer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Row>
          <Input value={reply} onChange={(e) => setReply(e.target.value)} className="flex-1" />
          <Button disabled={p.disabled} onClick={() => p.onReplyNow(reply)}>
            Reply now (S3)
          </Button>
        </Row>
        <Row>
          <Input value={fact} onChange={(e) => setFact(e.target.value)} className="flex-1" />
          <Button disabled={p.disabled} variant="secondary" onClick={() => p.onInjectFact(fact)}>
            Inject fact (S4)
          </Button>
          <Button disabled={p.disabled} variant="outline" onClick={() => p.onReplyNow(REPEAT_FACT)}>
            Ask to repeat
          </Button>
        </Row>
        <Row>
          <Input
            value={keyterms}
            onChange={(e) => setKeyterms(e.target.value)}
            className="flex-1"
          />
          <Button
            disabled={p.disabled}
            variant="secondary"
            onClick={() => p.onUpdateKeyterms(keyterms.split(",").map((t) => t.trim()))}
          >
            Update keyterms
          </Button>
          <Button disabled={p.disabled} variant="outline" onClick={p.onForceEndpoint}>
            ForceEndpoint
          </Button>
        </Row>
        <Row>
          <Button
            disabled={p.disabled || p.verbatim?.running === true}
            variant="secondary"
            onClick={() => p.onVerbatimTrial(10)}
          >
            Verbatim trial x10 (S5)
          </Button>
          {p.verbatim && (
            <span className="text-sm">
              {p.verbatim.matches}/{p.verbatim.outputs.length} exact
              {p.verbatim.running ? ", running" : ""}
            </span>
          )}
        </Row>
        {p.verbatim && p.verbatim.outputs.length > 0 && (
          <ol className="text-muted-foreground list-decimal pl-5 text-xs">
            {p.verbatim.outputs.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
