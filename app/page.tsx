import type { Metadata } from "next";
import { BuilderApp } from "./components/BuilderApp";
import { PremiumViewerControls } from "./components/PremiumViewerControls";
import { absolutePageUrl } from "../lib/site";
import { buildFallbackSharePreview, sharePreviewToMetadata } from "../lib/showroom/openGraph";

export const dynamic = "force-static";

const preview = buildFallbackSharePreview(absolutePageUrl());

export const metadata: Metadata = {
  ...sharePreviewToMetadata(preview),
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
