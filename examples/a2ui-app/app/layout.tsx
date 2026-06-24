import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "FlagDeck · A2UI demo",
  description: "A minimal A2UI renderer that closes the userAction loop.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
