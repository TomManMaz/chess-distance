import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess Distance Calculator",
  description:
    "Find the shortest opponent path between any two chess players, using FIDE-rated games from the TWIC archive.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
