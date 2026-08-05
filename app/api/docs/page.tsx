"use client";

import Script from "next/script";

declare global {
  interface Window {
    Redoc?: {
      init: (specUrl: string, options: Record<string, unknown>, element: HTMLElement | null) => void;
    };
  }
}

export default function ApiDocsPage() {
  const initializeRedoc = () => {
    const basePath = window.location.pathname.startsWith("/toyota-showroom/")
      ? "/toyota-showroom"
      : "";

    window.Redoc?.init(
      `${basePath}/catalog/openapi.yaml`,
      { hideDownloadButton: false, nativeScrollbars: true },
      document.getElementById("redoc-container"),
    );
  };

  return (
    <main style={{ minHeight: "100vh", background: "#fff" }}>
      <div id="redoc-container" />
      <Script
        src="https://cdn.redoc.ly/redoc/v2.5.0/bundles/redoc.standalone.js"
        strategy="afterInteractive"
        onLoad={initializeRedoc}
      />
    </main>
  );
}
