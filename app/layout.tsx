import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zhang Pathology | Diagnostic Excellence",
  description:
    "Professional pathology practice, medical education, clinical leadership, and diagnostic innovation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}