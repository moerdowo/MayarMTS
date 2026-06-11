import type { Metadata } from "next";
import { VT323, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-vt",
});

const jetbrains = JetBrains_Mono({
  weight: ["400", "500", "700", "800"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Mayar Transaction Monitor",
  description: "Live big-screen dashboard for your Mayar account",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${vt323.variable} ${jetbrains.variable}`}>
        {children}
      </body>
    </html>
  );
}
