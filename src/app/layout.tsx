import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backtesting",
  description: "Backtesting manuale con replay del grafico e simulazione di sfide prop firm",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
