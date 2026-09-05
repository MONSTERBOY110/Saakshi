import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
        Consent you can prove.
      </p>
      <h1 className="text-5xl font-semibold tracking-tight">Saakshi</h1>
      <p className="text-muted-foreground text-lg leading-relaxed">
        Saakshi is an AI witness that sits in on regulated sales conversations, knows who said what,
        speaks up the moment a customer is about to be misled, and ends by producing a verifiable
        Consent Certificate proving the customer understood what they agreed to.
      </p>
      <div>
        <Link href="/session" className={buttonVariants({ size: "lg" })}>
          Open session room
        </Link>
      </div>
      <p className="text-muted-foreground text-xs">
        Phase 0 build. Built on AssemblyAI Streaming STT (Universal-3.5 Pro, diarized) and the Voice
        Agent API.
      </p>
    </main>
  );
}
