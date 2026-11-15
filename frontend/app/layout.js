import { Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["600", "700"], style: ["italic"], variable: "--font-display" });
const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "Darkbid",
  description: "Private token sales on Robinhood Chain and Solana.",
};

export const viewport = { themeColor: "#060606" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
