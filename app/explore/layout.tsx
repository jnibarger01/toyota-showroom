import type { Metadata } from "next";
import { absolutePageUrl } from "../../lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: absolutePageUrl("explore"),
  },
};

export default function ExploreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
