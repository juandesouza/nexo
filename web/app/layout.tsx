import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "../lib/providers";

export const metadata: Metadata = {
  title: "NEXO",
  description: "Ride + Delivery Super App"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
