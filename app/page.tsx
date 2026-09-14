import type { Metadata } from "next";
import { BuilderApp } from "./components/BuilderApp";
import { PremiumViewerControls } from "./components/PremiumViewerControls";
import { absolutePageUrl } from "../lib/site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  alternates: {
    canonical: absolutePageUrl(),
  },
};

export default function Home() {
  return (
    <>
      <BuilderApp />
      <PremiumViewerControls />
    </>
  );
}
