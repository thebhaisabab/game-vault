import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({ subsets: ["latin"], variable: "--font-unbounded" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "GAME VAULT — your library, everywhere",
  description:
    "A personal game library that syncs across every device. Track what you're playing on PS5, PS4, Xbox, Switch and PC.",
};

export const viewport: Viewport = {
  themeColor: "#070709",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${unbounded.variable} ${grotesk.variable} ${jetbrains.variable}`}
    >
      <body className="bg-void text-ink antialiased">{children}</body>
    </html>
  );
}
