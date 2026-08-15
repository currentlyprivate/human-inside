import type { Metadata } from "next";
import Script from "next/script";
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
      {/* First-party visit analytics (currently.website / lookout). */}
      <Script
        src="https://lookout-api.currently.website/t.js"
        data-site="site_ae80da6b"
        strategy="afterInteractive"
      />
    </html>
  );
}
