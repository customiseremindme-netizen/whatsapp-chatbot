"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  defaultConfiguration,
  type PlatformConfiguration,
} from "@portalflow/shared";
import { api } from "../lib/api";
export function useBranding() {
  return useQuery({
    queryKey: ["branding"],
    queryFn: () => api<PlatformConfiguration>("/configuration"),
    staleTime: 30000,
  });
}
export function BrandName() {
  const { data } = useBranding();
  return <>{data?.brandName ?? defaultConfiguration.brandName}</>;
}
export function BrandingStyles() {
  const { data } = useBranding();
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--brand-primary",
      data?.primaryColor ?? defaultConfiguration.primaryColor,
    );
  }, [data]);
  return null;
}
export function SupportLink() {
  const { data } = useBranding();
  return data && data.supportEmail !== "support@example.com" ? (
    <a href={`mailto:${data.supportEmail}`} className="text-sm text-blue-600">
      Contact support
    </a>
  ) : null;
}
