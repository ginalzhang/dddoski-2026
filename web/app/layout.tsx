import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Shorts Gatekeeper",
  description: "A Shorts feed you have to earn, one quiz at a time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-black text-white">
        <Header />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
