import type { Metadata } from "next";
import { absolutePageUrl } from "../../lib/site";
import { buildFallbackSharePreview, sharePreviewToMetadata } from "../../lib/showroom/openGraph";

const preview = buildFallbackSharePreview(absolutePageUrl("garage"));

export const metadata: Metadata = {
  ...sharePreviewToMetadata({
    ...preview,
    title: "Garage | Toyota Showroom",
    description:
      "Your saved Toyota Showroom builds — reopen, compare, or share any configuration you have garaged.",
  }),
  alternates: {
    canonical: absolutePageUrl("garage"),
  },
};

export default function GarageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
