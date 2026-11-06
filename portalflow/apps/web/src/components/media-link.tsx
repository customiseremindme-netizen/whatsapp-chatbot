import { FileText, Image as ImageIcon } from "lucide-react";
import type { MediaMessage } from "@portalflow/shared";
/** Shows link-based media as a safe outbound link; external images are not
 * embedded, so the strict img-src CSP stays intact and no tracking pixel loads. */
export function MediaLink({ media }: { media: MediaMessage }) {
  const Icon = media.kind === "image" ? ImageIcon : FileText;
  let host = "";
  try {
    host = new URL(media.url).hostname;
  } catch {
    host = "invalid link";
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mb-2 flex items-center gap-2 rounded-lg border border-current/20 bg-black/5 px-3 py-2 text-xs underline-offset-2 hover:underline"
    >
      <Icon size={16} aria-hidden />
      <span className="min-w-0">
        <span className="block font-semibold">
          {media.kind === "image" ? "Image" : (media.filename ?? "Document")}
        </span>
        <span className="block truncate opacity-75">{host}</span>
      </span>
    </a>
  );
}
