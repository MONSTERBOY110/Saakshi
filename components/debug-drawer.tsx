"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatClockMs, type LogEvent, type LogSource } from "@/lib/session/log";

type Props = { events: LogEvent[]; onExport: () => void };

const SOURCES: Array<LogSource | "all"> = ["all", "stt", "agent", "client"];

export function DebugDrawer({ events, onExport }: Props) {
  const [source, setSource] = useState<LogSource | "all">("all");
  const [typeFilter, setTypeFilter] = useState("");

  const visible = useMemo(() => {
    const needle = typeFilter.trim().toLowerCase();
    return events
      .filter((e) => source === "all" || e.source === source)
      .filter((e) => !needle || e.type.toLowerCase().includes(needle))
      .slice(-400)
      .reverse();
  }, [events, source, typeFilter]);

  return (
    <Sheet>
      <SheetTrigger className={buttonVariants({ variant: "outline" })}>
        Debug drawer ({events.length})
      </SheetTrigger>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Raw socket events</SheetTitle>
          <SheetDescription>
            Newest first, last 400 shown. Audio payloads are stripped to length and head.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-2 px-4">
          <div className="flex gap-1">
            {SOURCES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={source === s ? "default" : "outline"}
                onClick={() => setSource(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          <Input
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="filter by type, e.g. Turn"
            className="max-w-56"
          />
          <Button size="sm" variant="secondary" onClick={onExport}>
            Export fixtures JSON
          </Button>
        </div>
        <ScrollArea className="h-[75vh] px-4 pb-4">
          <ul className="flex flex-col gap-1">
            {visible.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
            {visible.length === 0 && (
              <li className="text-muted-foreground py-6 text-center text-sm">No events yet.</li>
            )}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function EventRow({ event }: { event: LogEvent }) {
  return (
    <li>
      <details className="rounded-md border px-2 py-1 text-xs">
        <summary className="flex cursor-pointer items-center gap-2 font-mono">
          <span className="text-muted-foreground shrink-0">{formatClockMs(event.t)}</span>
          <Badge variant={badgeVariant(event.source)}>{event.source}</Badge>
          <span className="shrink-0 font-semibold">{event.type}</span>
          <span className="text-muted-foreground truncate">{preview(event.payload)}</span>
        </summary>
        <pre className="bg-muted mt-1 max-h-72 overflow-auto rounded p-2 break-all whitespace-pre-wrap">
          {JSON.stringify(event.payload, null, 1)}
        </pre>
      </details>
    </li>
  );
}

function badgeVariant(source: LogSource): "default" | "secondary" | "outline" {
  if (source === "stt") return "default";
  if (source === "agent") return "secondary";
  return "outline";
}

function preview(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const text = p.transcript ?? p.text ?? p.delta ?? p.message ?? p.content;
    if (typeof text === "string") return text.slice(0, 90);
    if (typeof p.speaker_label === "string") return `speaker ${p.speaker_label}`;
  }
  const s = JSON.stringify(payload) ?? "";
  return s.length > 90 ? `${s.slice(0, 90)}...` : s;
}
