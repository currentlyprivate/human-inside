import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Human Inside",
  description: "A human. Working. With AI.",
  openGraph: {
    title: "Human Inside",
    description: "A human. Working. With AI.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
