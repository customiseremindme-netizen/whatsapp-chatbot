import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
export const metadata: Metadata = {
  title: "PortalFlow — Business workspace",
  description: "A secure workspace for your business conversations.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
