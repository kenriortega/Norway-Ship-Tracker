import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Norway Ship Tracker",
  description: "Seguimiento AIS de barcos en aguas noruegas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

