import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: "MinRV — 44.01",
  description:
    "MinRV is 44.01 Digitalisation’s digital MRV control room: quality intelligence on project evidence through to registry submission.",
};

export const viewport: Viewport = {
  themeColor: "#070808",
  colorScheme: "dark",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${display.variable} h-full bg-rock`}>{children}</div>
  );
}
