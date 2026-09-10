import { BuilderApp } from "./components/BuilderApp";
import { PremiumViewerControls } from "./components/PremiumViewerControls";

export const dynamic = "force-static";

export default function Home() {
  return (
    <>
      <BuilderApp />
      <PremiumViewerControls />
    </>
  );
}
