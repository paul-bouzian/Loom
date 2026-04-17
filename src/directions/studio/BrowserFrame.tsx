import { toPreviewUrl } from "../../lib/browser-preview";

type Props = {
  tabId: string;
  url: string;
  reloadNonce: number;
  active: boolean;
  onLoad: (tabId: string) => void;
};

const BLANK_URL = "about:blank";

export function BrowserFrame({
  tabId,
  url,
  reloadNonce,
  active,
  onLoad,
}: Props) {
  const iframeSrc = url ? toPreviewUrl(url) : BLANK_URL;

  return (
    <iframe
      key={`${tabId}:${reloadNonce}:${iframeSrc}`}
      className={`browser-frame ${active ? "" : "browser-frame--hidden"}`}
      data-testid="browser-frame"
      data-tab-id={tabId}
      src={iframeSrc}
      title={`Browser tab ${tabId}`}
      onLoad={() => onLoad(tabId)}
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}
