"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandingStyles } from "../components/branding";
import { useState, useEffect } from "react";
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 10000 } },
      }),
  );
  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      localStorage.getItem("theme") === "dark",
    );
  }, []);
  return (
    <QueryClientProvider client={client}>
      <BrandingStyles />
      {children}
    </QueryClientProvider>
  );
}
