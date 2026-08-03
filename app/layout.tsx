import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Toyota Showroom",
  description: "WebGPU Toyota 4Runner configurator"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
