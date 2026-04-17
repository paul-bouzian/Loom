import { useEffect, useRef } from "react";

import { toPreviewUrl } from "../../lib/browser-preview";

type Props = {
  tabId: string;
  url: string;
  reloadNonce: number;
  active: boolean;
  onLoad: (tabId: string) => void;
  onLoadError?: (tabId: string) => void;
};

const BLANK_URL = "about:blank";

export function BrowserFrame({
  tabId,
  url,
  reloadNonce,
  active,
  onLoad,
  onLoadError,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeSrc = url ? toPreviewUrl(url) : BLANK_URL;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => onLoad(tabId);
    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, [tabId, onLoad, reloadNonce, url]);

  return (
    <iframe
      ref={iframeRef}
      key={`${tabId}:${reloadNonce}:${iframeSrc}`}
      className={`browser-frame ${active ? "" : "browser-frame--hidden"}`}
      data-testid="browser-frame"
      data-tab-id={tabId}
      src={iframeSrc}
      title={`Browser tab ${tabId}`}
      onError={() => onLoadError?.(tabId)}
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}
