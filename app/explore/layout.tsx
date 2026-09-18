import type { Metadata } from "next";
import { absolutePageUrl } from "../../lib/site";
import { buildFallbackSharePreview, sharePreviewToMetadata } from "../../lib/showroom/openGraph";

const preview = buildFallbackSharePreview(absolutePageUrl("explore"));

export const metadata: Metadata = {
  ...sharePreviewToMetadata({
    ...preview,
    title: "Explore | Toyota Showroom",
    description: "Browse the Toyota Showroom lineup and open a builder for any catalog vehicle.",
  }),
  alternates: {
    canonical: absolutePageUrl("explore"),
  },
};

export default function ExploreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
