import type { Metadata } from "next";
import { Manrope, Martian_Mono, Unbounded } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const martian = Martian_Mono({ variable: "--font-martian", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Code Sentinel", template: "%s · Code Sentinel" },
  description: "Five review agents check every pull request. Critical findings always block the merge.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${unbounded.variable} ${manrope.variable} ${martian.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
