import Script from "next/script";

export default function ApiDocsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#fff" }}>
      <div id="redoc-container" />
      <Script
        src="https://cdn.redoc.ly/redoc/v2.5.0/bundles/redoc.standalone.js"
        strategy="afterInteractive"
      />
      <Script id="initialize-redoc" strategy="afterInteractive">
        {`
          const basePath = window.location.pathname.startsWith('/toyota-showroom/')
            ? '/toyota-showroom'
            : '';
          window.Redoc.init(
            basePath + '/catalog/openapi.yaml',
            { hideDownloadButton: false, nativeScrollbars: true },
            document.getElementById('redoc-container')
          );
        `}
      </Script>
    </main>
  );
}
