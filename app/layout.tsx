import type { Metadata } from "next";
import { Alfa_Slab_One, Archivo, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const display = Alfa_Slab_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Archivo({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const data = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Saakshi",
  description:
    "AI witness for regulated sales conversations. Hears who said what in English or Hinglish, interrupts mis-selling, runs a teach-back, and issues a verifiable Consent Certificate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${data.variable} bg-paper text-ink font-body min-h-screen antialiased`}
      >
        {/*
          THESIS: A compliance record is a called game, not a dashboard. Every disclosure is a named,
          numbered card on one tabla the room fills in whatever order the conversation deals it. It
          refuses the dark-gradient hero with a tilted glass screenshot.
          OWN-WORLD: Cream stock, heavy black contour ink, flat turquoise, sun and rose fields,
          carnival red borders, a bean as the mark of progress. Alfa Slab One shouts, Archivo speaks,
          Spline Sans Mono counts. Printed offset shadow, dashed rules, ribbon headers.
          STORY: A stranger sees a game they already know the rules of, understands that every claim
          carries its own evidence, and opens the room or verifies a certificate.
          FIRST VIEWPORT: Full-bleed cream. Display headline left at 6rem. The called card centre
          right, the tabla right, both real. Primary action is a bordered carnival-red plate.
          FORM: Loteria tabla night, chosen by the owner over the assigned direction. Seed 9be69d51.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
          the verdict, DESIGN.md, and every shipping raster carrying its provenance.
        */}
        {children}
      </body>
    </html>
  );
}
