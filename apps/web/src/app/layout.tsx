import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Universal Business OS",
  description: "A secure operating system for your business.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="ambient-bg" />
        {children}
      </body>
    </html>
  );
}
/* probe */
