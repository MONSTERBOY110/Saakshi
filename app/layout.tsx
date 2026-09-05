import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saakshi",
  description:
    "AI witness for regulated sales conversations. Hears who said what in English or Hinglish, interrupts mis-selling, runs a teach-back, and issues a verifiable Consent Certificate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
