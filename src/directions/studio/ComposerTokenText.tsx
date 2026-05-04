import type {
  ComposerMentionBindingInput,
  ProviderKind,
  ThreadComposerCatalog,
} from "../../lib/types";
import {
  CubeIcon,
  FolderIcon,
  GlobeIcon,
  HammerIcon,
} from "../../shared/Icons";
import { renderTextWithExternalLinks } from "./conversation-links";
import {
  decorateComposerText,
  type ComposerMirrorSegment,
  PROMPT_PREFIX,
} from "./composer/composer-model";
import { filePathDisplay } from "./composer/file-path-display";

type ComposerTokenTextProps = {
  text: string;
  catalog?: ThreadComposerCatalog | null;
  provider: ProviderKind;
  cursorIndex?: number | null;
  decorateAllProviderTokens?: boolean;
  decorateFileTokens?: boolean;
  decorateUnknownTokens?: boolean;
  keyPrefix: string;
  linkifyText?: boolean;
  mentionBindings?: ComposerMentionBindingInput[];
};

export function ComposerTokenText({
  text,
  catalog = null,
  provider,
  cursorIndex = null,
  decorateAllProviderTokens = false,
  decorateFileTokens = true,
  decorateUnknownTokens = false,
  keyPrefix,
  linkifyText = false,
  mentionBindings = [],
}: ComposerTokenTextProps) {
  const segments = decorateComposerText(text, catalog, provider, {
    decorateAllProviderTokens,
    decorateFileTokens,
    decorateUnknownTokens,
    mentionBindings,
  });
  let sourceCursor = 0;

  return (
    <>
      {segments.map((segment, index) => {
        const range =
          segment.kind === "text"
            ? {
                start: sourceCursor,
                end: sourceCursor + segment.text.length,
              }
            : { start: segment.start, end: segment.end };
        sourceCursor = range.end;
        return renderComposerSegment(
          segment,
          `${keyPrefix}-${index}`,
          linkifyText,
          cursorIndex,
          range,
        );
      })}
    </>
  );
}

function renderComposerSegment(
  segment: ComposerMirrorSegment,
  key: string,
  linkifyText: boolean,
  cursorIndex: number | null,
  range: { start: number; end: number },
) {
  if (segment.kind === "text") {
    return (
      <span key={key} data-source-start={range.start}>
        {linkifyText
          ? renderTextWithExternalLinks(segment.text, key)
          : segment.text}
      </span>
    );
  }

  const cursorInToken =
    cursorIndex !== null &&
    cursorIndex >= range.start &&
    cursorIndex <= range.end;

  if (cursorInToken) {
    const display = displayForComposerToken(segment);
    return (
      <span
        key={key}
        className={`tx-inline-token tx-inline-token--${display.tone}`}
        data-source-start={range.start}
      >
        {segment.text}
      </span>
    );
  }

  return <ComposerTokenBadge key={key} segment={segment} range={range} />;
}

function ComposerTokenBadge({
  segment,
  range,
}: {
  segment: Exclude<ComposerMirrorSegment, { kind: "text" }>;
  range: { start: number; end: number };
}) {
  const display = displayForComposerToken(segment);
  const Icon = iconForComposerToken(segment);
  const classes = [
    "tx-inline-token",
    "tx-inline-token-badge",
    `tx-inline-token--${display.tone}`,
  ].join(" ");

  return (
    <span
      className={classes}
      title={segment.text}
      data-token-start={range.start}
      data-token-end={range.end}
    >
      <Icon size={12} className="tx-inline-token-badge__icon" />
      <span className="tx-inline-token-badge__label">{display.label}</span>
      {display.detail ? (
        <span className="tx-inline-token-badge__detail">{display.detail}</span>
      ) : null}
    </span>
  );
}

function displayForComposerToken(
  segment: Exclude<ComposerMirrorSegment, { kind: "text" }>,
) {
  if (segment.kind === "prompt") {
    const promptDisplay = displayForPromptToken(segment.text);
    return {
      label: promptDisplay.label,
      detail: promptDisplay.detail,
      tone: promptDisplay.tone,
    };
  }

  if (segment.kind === "file") {
    const path = segment.text.startsWith("@")
      ? segment.text.slice(1)
      : segment.text;
    const display = filePathDisplay(path, segment.text);
    return {
      label: display.label,
      detail: display.directory,
      tone: "file",
    };
  }

  return {
    label: segment.text,
    detail: null,
    tone: segment.kind,
  };
}

function displayForPromptToken(text: string) {
  if (!text.startsWith(PROMPT_PREFIX)) {
    return {
      label: text,
      detail: null,
      tone: "command",
    };
  }

  const openIndex = text.indexOf("(");
  const nameEnd = openIndex === -1 ? text.length : openIndex;
  const name = text.slice(PROMPT_PREFIX.length, nameEnd);
  const rawDetail = openIndex === -1 ? "" : text.slice(openIndex);
  return {
    label: `/${name}`,
    detail: rawDetail === "()" ? null : rawDetail,
    tone: "prompt",
  };
}

function iconForComposerToken(
  segment: Exclude<ComposerMirrorSegment, { kind: "text" }>,
) {
  if (segment.kind === "skill") {
    return HammerIcon;
  }
  if (segment.kind === "app") {
    return GlobeIcon;
  }
  if (segment.kind === "file") {
    return FolderIcon;
  }
  return CubeIcon;
}
