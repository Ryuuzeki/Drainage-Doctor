import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DrainageDoctor — Stormwater diagnostic workspace",
  description: "Investigate drainage hotspots, compare interventions, and keep engineering evidence traceable.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
