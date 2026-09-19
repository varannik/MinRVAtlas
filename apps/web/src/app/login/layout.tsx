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
    "MinRV is 44.01’s digital MRV control room, connected to multiple registries. Sign in with Cognito.",
};

export const viewport: Viewport = {
  themeColor: "#0B0B0F",
  colorScheme: "dark",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${display.variable} h-full bg-[#0b0b0f]`}>{children}</div>
  );
}
