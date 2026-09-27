import type { Metadata } from "next";
import { absolutePageUrl } from "../../lib/site";
import { buildFallbackSharePreview, sharePreviewToMetadata } from "../../lib/showroom/openGraph";

const preview = buildFallbackSharePreview(absolutePageUrl("compare"));

export const metadata: Metadata = {
  ...sharePreviewToMetadata({
    ...preview,
    title: "Compare | Toyota Showroom",
    description:
      "Compare saved Toyota Showroom builds side by side — specs, pricing, and a shared 3D stage.",
  }),
  alternates: {
    canonical: absolutePageUrl("compare"),
  },
};

export default function CompareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
