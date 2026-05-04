import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CheckIcon, CopyIcon } from "../../shared/Icons";
import {
  isWindowsAbsolutePath,
  parseFileReferenceTarget,
  type FileReferenceTarget,
} from "./conversation-file-references";
import { handleExternalLinkClick, isValidExternalUrl } from "./conversation-links";

type Props = {
  markdown: string;
  className?: string;
  onFileReferenceClick?: (target: FileReferenceTarget) => void;
};

type MarkdownNode = {
  properties?: Record<string, unknown>;
};
type MarkdownLinkAttributes = Pick<
  ComponentProps<"a">,
  "aria-describedby" | "className" | "id" | "title"
> & {
  "data-footnote-backref"?: string;
  "data-footnote-ref"?: string;
};
type MarkdownLinkTargetParts = {
  destinationEnd: number;
  destinationStart: number;
};

const MARKDOWN_REMARK_PLUGINS = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: true }],
] satisfies NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
const MARKDOWN_REHYPE_PLUGINS = [
  [rehypeKatex, { output: "htmlAndMathml", strict: false, throwOnError: false }],
] satisfies NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

type TextTransform = (value: string) => string;

const CODE_FENCE_LANGUAGE_PATTERN = /(?:^|\s)language-([^\s]+)/;
const ESCAPED_MARKDOWN_DOLLAR = "\\$";
const FILE_REFERENCE_HREF_PREFIX = "https://skein.local/__file_reference__/";
const LITERAL_LINK_HREF_PREFIX = "https://skein.local/__literal_link__/";
const INLINE_MATH_HINT_PATTERN = /[\\^_=+\-*/<>()[\]{}]/;
const ALL_CAPS_DOLLAR_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

export function ConversationMarkdown({
  markdown,
  className,
  onFileReferenceClick,
}: Props) {
  const classes = ["tx-markdown", className].filter(Boolean).join(" ");
  const normalizedMarkdown = useMemo(
    () => normalizeMarkdownLinkTargets(protectLiteralMarkdownDollars(markdown)),
    [markdown],
  );
  const components = useMemo<Components>(
    () => createMarkdownComponents(onFileReferenceClick),
    [onFileReferenceClick],
  );

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function createMarkdownComponents(
  onFileReferenceClick?: (target: FileReferenceTarget) => void,
): Components {
  return {
    h1: ({ children }) => renderHeading(1, children),
    h2: ({ children }) => renderHeading(2, children),
    h3: ({ children }) => renderHeading(3, children),
    h4: ({ children }) => renderHeading(4, children),
    h5: ({ children }) => renderHeading(5, children),
    h6: ({ children }) => renderHeading(6, children),
    p: ({ children }) => <p className="tx-markdown__paragraph">{children}</p>,
    ul: ({ node, children, className, ...props }) => (
      <ul
        {...props}
        className={mergeClassNames(
          "tx-markdown__list",
          className,
          getNodeClassName(node),
        )}
      >
        {children}
      </ul>
    ),
    ol: ({ node, children, className, ...props }) => (
      <ol
        {...props}
        className={mergeClassNames(
          "tx-markdown__list",
          className,
          getNodeClassName(node),
        )}
      >
        {children}
      </ol>
    ),
    li: ({ node, children, className, ...props }) => (
      <li {...props} className={mergeClassNames(className, getNodeClassName(node))}>
        {children}
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="tx-markdown__blockquote">{children}</blockquote>
    ),
    hr: () => <hr className="tx-markdown__rule" />,
    table: ({ children }) => (
      <div className="tx-markdown__table-scroll">
        <table className="tx-markdown__table">{children}</table>
      </div>
    ),
    th: ({ children, style }) => (
      <th className="tx-markdown__table-cell tx-markdown__table-cell--header" style={style}>
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td className="tx-markdown__table-cell" style={style}>
        {children}
      </td>
    ),
    del: ({ children }) => <del className="tx-markdown__delete">{children}</del>,
    input: ({ node, type, checked, className, ...props }) => {
      if (type !== "checkbox") {
        return <input {...props} type={type} className={className} disabled readOnly />;
      }
      return (
        <input
          {...props}
          type="checkbox"
          checked={Boolean(checked ?? getNodeBooleanProperty(node, "checked"))}
          className={mergeClassNames("tx-markdown__task-checkbox", className)}
          disabled
          readOnly
        />
      );
    },
    a: ({ node, children, href, className }) =>
      renderMarkdownLink(
        children,
        href,
        buildMarkdownLinkAttributes(node, className),
        onFileReferenceClick,
      ),
    img: ({ alt }) => (
      <span className="tx-markdown__image-placeholder">
        {alt ? `[image: ${alt}]` : "[image]"}
      </span>
    ),
    code: ({ children, className }) => (
      <code className={className ? `tx-markdown__code ${className}` : "tx-markdown__code"}>
        {children}
      </code>
    ),
    pre: ({ children }) => renderCodeBlock(children),
  };
}

function renderHeading(depth: 1 | 2 | 3 | 4 | 5 | 6, children: ReactNode) {
  const HeadingTag = `h${depth}` as const;
  return (
    <HeadingTag className={`tx-markdown__heading tx-markdown__heading--${depth}`}>
      {children}
    </HeadingTag>
  );
}

function renderMarkdownLink(
  children: ReactNode,
  href: string | undefined,
  linkAttributes: MarkdownLinkAttributes,
  onFileReferenceClick?: (target: FileReferenceTarget) => void,
) {
  const safeHref = href ?? "";
  const fileReferenceHref = decodePlaceholderHref(safeHref, FILE_REFERENCE_HREF_PREFIX);
  const literalHref = decodePlaceholderHref(safeHref, LITERAL_LINK_HREF_PREFIX);
  const label = nodeToPlainText(children);
  const fileReference = parseFileReferenceTarget(fileReferenceHref ?? safeHref);

  if (fileReferenceHref && fileReference) {
    return renderFileReferenceToken(children, label, fileReference, onFileReferenceClick);
  }

  if (literalHref !== null) {
    return <>{`[${label}](${literalHref})`}</>;
  }

  if (fileReference) {
    return renderFileReferenceToken(children, label, fileReference, onFileReferenceClick);
  }

  if (safeHref.startsWith("#")) {
    return (
      <a
        {...linkAttributes}
        className={mergeClassNames("tx-markdown__link", linkAttributes.className)}
        href={safeHref}
      >
        {children}
      </a>
    );
  }

  if (isValidExternalUrl(safeHref)) {
    return (
      <a
        {...linkAttributes}
        className={mergeClassNames("tx-markdown__link", linkAttributes.className)}
        href={safeHref}
        rel="noreferrer"
        onClick={(event) => handleExternalLinkClick(event, safeHref)}
      >
        {children}
      </a>
    );
  }

  return <>{`[${label}](${safeHref})`}</>;
}

function renderFileReferenceToken(
  children: ReactNode,
  label: string,
  target: FileReferenceTarget,
  onFileReferenceClick?: (target: FileReferenceTarget) => void,
) {
  const fileReferenceProps = {
    className: "tx-inline-token tx-inline-token--file tx-markdown__file-ref",
    title: target.rawTarget,
    "data-file-path": target.filePath,
    "data-file-line": target.line ?? undefined,
    "data-file-column": target.column ?? undefined,
  };

  if (!onFileReferenceClick) {
    return (
      <span {...fileReferenceProps}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      {...fileReferenceProps}
      aria-label={`Open ${label}`}
      onClick={() => onFileReferenceClick(target)}
    >
      {children}
    </button>
  );
}

function renderCodeBlock(children: ReactNode) {
  const codeBlock = extractCodeBlock(children);
  if (!codeBlock) {
    return <pre className="tx-markdown__code-block">{children}</pre>;
  }

  return (
    <MarkdownCodeBlock code={codeBlock.code} language={codeBlock.language}>
      <pre className="tx-markdown__code-block">
        <code className={codeBlock.className}>{codeBlock.code}</code>
      </pre>
    </MarkdownCodeBlock>
  );
}

function MarkdownCodeBlock({
  children,
  code,
  language,
}: {
  children: ReactNode;
  code: string;
  language: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleCopy = () => {
    const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard
      .writeText(code)
      .then(() => {
        if (!mountedRef.current) {
          return;
        }
        setCopied(true);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  };

  return (
    <div className="tx-markdown__code-block-shell">
      <button
        type="button"
        className="tx-markdown__code-copy-button"
        aria-label={copied ? "Copied code" : "Copy code"}
        title={copied ? "Copied code" : "Copy code"}
        onClick={handleCopy}
      >
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
      {language ? <span className="tx-markdown__code-language-label">{language}</span> : null}
      {children}
    </div>
  );
}

function extractCodeBlock(children: ReactNode) {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const codeElement = childNodes[0];
  if (!isValidElement<{ children?: ReactNode; className?: string }>(codeElement)) {
    return null;
  }

  const className = codeElement.props.className;
  const language = extractFenceLanguage(className);
  return {
    className,
    code: nodeToPlainText(codeElement.props.children).replace(/\n$/, ""),
    language,
  };
}

function extractFenceLanguage(className: string | undefined) {
  const match = className?.match(CODE_FENCE_LANGUAGE_PATTERN);
  return match?.[1] ?? null;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function buildMarkdownLinkAttributes(
  node: MarkdownNode | undefined,
  className: string | undefined,
): MarkdownLinkAttributes {
  return {
    "aria-describedby": getNodeStringProperty(node, "aria-describedby", "ariaDescribedBy"),
    className: mergeClassNames(className, getNodeClassName(node)),
    "data-footnote-backref": getNodeStringProperty(
      node,
      "data-footnote-backref",
      "dataFootnoteBackref",
    ),
    "data-footnote-ref": getNodeStringProperty(
      node,
      "data-footnote-ref",
      "dataFootnoteRef",
    ),
    id: getNodeStringProperty(node, "id"),
    title: getNodeStringProperty(node, "title"),
  };
}

function getNodeClassName(node: MarkdownNode | undefined): string {
  return classNameFromUnknown(node?.properties?.className);
}

function getNodeStringProperty(
  node: MarkdownNode | undefined,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = node?.properties?.[name];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (value === true) {
      return "";
    }
  }
  return undefined;
}

function getNodeBooleanProperty(
  node: MarkdownNode | undefined,
  name: string,
): boolean | undefined {
  const value = node?.properties?.[name];
  return typeof value === "boolean" ? value : undefined;
}

function mergeClassNames(...values: unknown[]): string | undefined {
  const className = values
    .map((value) => classNameFromUnknown(value))
    .filter(Boolean)
    .join(" ");
  return className || undefined;
}

function classNameFromUnknown(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => classNameFromUnknown(entry)).filter(Boolean).join(" ");
  }
  return "";
}

function markdownUrlTransform(url: string) {
  if (
    url.startsWith("#") ||
    isValidExternalUrl(url) ||
    parseFileReferenceTarget(url)
  ) {
    return url;
  }
  return defaultUrlTransform(url);
}

function normalizeMarkdownLinkTargets(value: string): string {
  return transformOutsideCode(value, normalizeMarkdownLinkTargetsInPlainText);
}

function protectLiteralMarkdownDollars(value: string): string {
  return transformOutsideCode(value, protectLiteralDollarsOutsideMarkdownLinks);
}

function transformOutsideCode(value: string, transformPlainText: TextTransform): string {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const fence = matchFenceDelimiter(value, cursor);
    if (fence) {
      const end = findFenceEndIndex(value, cursor, fence.marker, fence.length);
      result += value.slice(cursor, end);
      cursor = end;
      continue;
    }

    if (value[cursor] === "`") {
      const end = findInlineCodeEndIndex(value, cursor);
      result += value.slice(cursor, end);
      cursor = end;
      continue;
    }

    const nextProtectedIndex = findNextCodeLikeIndex(value, cursor);
    result += transformPlainText(value.slice(cursor, nextProtectedIndex));
    cursor = nextProtectedIndex;
  }

  return result;
}

function normalizeMarkdownLinkTargetsInPlainText(value: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const link = readInlineMarkdownLink(value, cursor);
    if (!link) {
      result += value[cursor] ?? "";
      cursor += 1;
      continue;
    }

    const target = value.slice(link.targetStart, link.targetEnd);
    const normalizedTarget = normalizeMarkdownLinkTargetPayload(target);
    result +=
      value.slice(cursor, link.targetStart) +
      normalizedTarget +
      value.slice(link.targetEnd, link.end);
    cursor = link.end;
  }

  return result;
}

function normalizeMarkdownLinkTargetPayload(target: string): string {
  const targetParts = readMarkdownLinkTargetParts(target);
  if (!targetParts) {
    return normalizeMarkdownLinkTarget(target);
  }

  const destination = target.slice(targetParts.destinationStart, targetParts.destinationEnd);
  const normalizedDestination = normalizeMarkdownLinkDestination(destination);
  if (!normalizedDestination) {
    return normalizeMarkdownLinkTarget(target);
  }

  return (
    target.slice(0, targetParts.destinationStart) +
    normalizedDestination +
    target.slice(targetParts.destinationEnd)
  );
}

function normalizeMarkdownLinkTarget(target: string): string {
  if (target.startsWith("#") || isValidExternalUrl(target)) {
    return target;
  }
  if (parseFileReferenceTarget(target)) {
    return `${FILE_REFERENCE_HREF_PREFIX}${encodeURIComponent(target)}`;
  }
  return `${LITERAL_LINK_HREF_PREFIX}${encodeURIComponent(target)}`;
}

function normalizeMarkdownLinkDestination(destination: string): string | null {
  const angleDestination = unwrapAngleMarkdownDestination(destination);
  const target = angleDestination ?? destination;
  if (target.startsWith("#") || isValidExternalUrl(target)) {
    return destination;
  }
  if (parseFileReferenceTarget(target)) {
    return `${FILE_REFERENCE_HREF_PREFIX}${encodeURIComponent(target)}`;
  }
  return null;
}

function decodePlaceholderHref(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) {
    return null;
  }
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return value.slice(prefix.length);
  }
}

function protectLiteralDollarsOutsideMarkdownLinks(value: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const isLinkStart =
      value[cursor] === "[" || (value[cursor] === "!" && value[cursor + 1] === "[");
    if (!isLinkStart) {
      const nextLink = value.indexOf("[", cursor);
      const nextImage = value.indexOf("![", cursor);
      const candidates = [nextLink, nextImage].filter((index) => index >= 0);
      const nextIndex = candidates.length > 0 ? Math.min(...candidates) : value.length;
      result += protectLiteralDollarsInPlainText(value.slice(cursor, nextIndex));
      cursor = nextIndex;
      continue;
    }

    const link = readInlineMarkdownLink(value, cursor);
    if (!link) {
      result += protectLiteralDollarsInPlainText(value[cursor] ?? "");
      cursor += 1;
      continue;
    }

    result += value.slice(cursor, link.end);
    cursor = link.end;
  }

  return result;
}

function protectLiteralDollarsInPlainText(value: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] === "\\" && value[cursor + 1] === "$") {
      result += ESCAPED_MARKDOWN_DOLLAR;
      cursor += 2;
      continue;
    }

    if (value.startsWith("$$", cursor)) {
      const closingIndex = value.indexOf("$$", cursor + 2);
      if (closingIndex === -1) {
        result += `${ESCAPED_MARKDOWN_DOLLAR}${ESCAPED_MARKDOWN_DOLLAR}`;
        cursor += 2;
        continue;
      }
      result += value.slice(cursor, closingIndex + 2);
      cursor = closingIndex + 2;
      continue;
    }

    if (value[cursor] === "$") {
      if (!canOpenInlineMath(value, cursor)) {
        result += ESCAPED_MARKDOWN_DOLLAR;
        cursor += 1;
        continue;
      }

      const closingIndex = findInlineMathClosingDollar(value, cursor + 1);
      if (closingIndex === -1) {
        result += ESCAPED_MARKDOWN_DOLLAR;
        cursor += 1;
        continue;
      }

      const content = value.slice(cursor + 1, closingIndex);
      result += looksLikeInlineMath(content)
        ? `$${content}$`
        : `${ESCAPED_MARKDOWN_DOLLAR}${content}${ESCAPED_MARKDOWN_DOLLAR}`;
      cursor = closingIndex + 1;
      continue;
    }

    result += value[cursor];
    cursor += 1;
  }

  return result;
}

function looksLikeInlineMath(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || ALL_CAPS_DOLLAR_IDENTIFIER_PATTERN.test(trimmed)) {
    return false;
  }
  return INLINE_MATH_HINT_PATTERN.test(trimmed) || /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(trimmed);
}

function canOpenInlineMath(value: string, index: number): boolean {
  const next = value[index + 1];
  return Boolean(next && !/\s|\d/.test(next));
}

function canCloseInlineMath(value: string, index: number): boolean {
  const previous = value[index - 1];
  return Boolean(previous && !/\s/.test(previous));
}

function findInlineMathClosingDollar(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "$") {
      return canCloseInlineMath(value, cursor) ? cursor : -1;
    }
    cursor += 1;
  }
  return -1;
}

function findNextCodeLikeIndex(value: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < value.length) {
    if (value[cursor] === "`" || matchFenceDelimiter(value, cursor)) {
      return cursor;
    }
    cursor += 1;
  }
  return value.length;
}

function isLineStart(value: string, index: number): boolean {
  return index === 0 || value[index - 1] === "\n";
}

function indentedFenceMarkerStart(
  value: string,
  lineStart: number,
  marker: "`" | "~",
): number | null {
  let markerStart = lineStart;
  while (value[markerStart] === " ") {
    markerStart += 1;
  }
  return markerStart - lineStart <= 3 && value[markerStart] === marker
    ? markerStart
    : null;
}

function matchFenceDelimiter(
  value: string,
  index: number,
): { marker: "`" | "~"; length: number } | null {
  const lineStart = value.lastIndexOf("\n", index - 1) + 1;
  const marker = value[index];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  if (indentedFenceMarkerStart(value, lineStart, marker) !== index) {
    return null;
  }

  let cursor = index;
  while (value[cursor] === marker) {
    cursor += 1;
  }

  return cursor - index >= 3 ? { marker, length: cursor - index } : null;
}

function findFenceEndIndex(
  value: string,
  index: number,
  marker: "`" | "~",
  length: number,
): number {
  let cursor = value.indexOf("\n", index);
  if (cursor === -1) {
    return value.length;
  }
  cursor += 1;

  while (cursor < value.length) {
    if (isLineStart(value, cursor)) {
      const markerStart = indentedFenceMarkerStart(value, cursor, marker);
      let markerEnd = markerStart ?? cursor;
      while (value[markerEnd] === marker) {
        markerEnd += 1;
      }
      if (markerStart !== null && markerEnd - markerStart >= length) {
        const lineEnd = value.indexOf("\n", markerEnd);
        return lineEnd === -1 ? value.length : lineEnd + 1;
      }
    }

    const nextLine = value.indexOf("\n", cursor);
    if (nextLine === -1) {
      return value.length;
    }
    cursor = nextLine + 1;
  }

  return value.length;
}

function findInlineCodeEndIndex(value: string, index: number): number {
  let markerEnd = index;
  while (value[markerEnd] === "`") {
    markerEnd += 1;
  }

  const length = markerEnd - index;
  let cursor = markerEnd;
  while (cursor < value.length) {
    if (value[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let end = cursor;
    while (value[end] === "`") {
      end += 1;
    }
    if (end - cursor === length) {
      return end;
    }
    cursor = end;
  }

  return value.length;
}

function readInlineMarkdownLink(
  value: string,
  index: number,
): { end: number; targetStart: number; targetEnd: number } | null {
  const bracketStart = value[index] === "!" && value[index + 1] === "[" ? index + 1 : index;
  if (value[bracketStart] !== "[") {
    return null;
  }

  const bracketEnd = findMarkdownBracketEnd(value, bracketStart);
  if (bracketEnd === -1 || value[bracketEnd + 1] !== "(") {
    return null;
  }

  const parenEnd = findMarkdownParenEnd(value, bracketEnd + 1);
  if (parenEnd === -1) {
    return null;
  }
  return {
    end: parenEnd + 1,
    targetEnd: parenEnd,
    targetStart: bracketEnd + 2,
  };
}

function readMarkdownLinkTargetParts(value: string): MarkdownLinkTargetParts | null {
  const destinationStart = skipMarkdownWhitespace(value, 0);
  if (destinationStart >= value.length) {
    return null;
  }

  const destinationEnd =
    value[destinationStart] === "<"
      ? findAngleMarkdownDestinationEnd(value, destinationStart)
      : findBareMarkdownDestinationEnd(value, destinationStart);
  if (destinationEnd === -1) {
    return null;
  }

  let cursor = skipMarkdownWhitespace(value, destinationEnd);
  if (cursor >= value.length) {
    return { destinationEnd, destinationStart };
  }

  const titleEnd = findMarkdownLinkTitleEnd(value, cursor);
  if (titleEnd === -1) {
    return null;
  }

  cursor = skipMarkdownWhitespace(value, titleEnd);
  return cursor === value.length ? { destinationEnd, destinationStart } : null;
}

function skipMarkdownWhitespace(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length && /\s/.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findAngleMarkdownDestinationEnd(value: string, startIndex: number): number {
  let cursor = startIndex + 1;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === ">") {
      return cursor + 1;
    }
    if (value[cursor] === "\n") {
      return -1;
    }
    cursor += 1;
  }
  return -1;
}

function findBareMarkdownDestinationEnd(value: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (/\s/.test(value[cursor] ?? "")) {
      return cursor;
    }
    cursor += 1;
  }
  return cursor;
}

function findMarkdownLinkTitleEnd(value: string, startIndex: number): number {
  const marker = value[startIndex];
  if (marker === "\"" || marker === "'") {
    return findQuotedMarkdownTitleEnd(value, startIndex, marker);
  }
  if (marker === "(") {
    return findParenthesizedMarkdownTitleEnd(value, startIndex);
  }
  return -1;
}

function findQuotedMarkdownTitleEnd(
  value: string,
  startIndex: number,
  marker: "\"" | "'",
): number {
  let cursor = startIndex + 1;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === marker) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return -1;
}

function findParenthesizedMarkdownTitleEnd(value: string, startIndex: number): number {
  let depth = 0;
  let cursor = startIndex;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "(") {
      depth += 1;
    } else if (value[cursor] === ")") {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return -1;
}

function unwrapAngleMarkdownDestination(destination: string): string | null {
  if (!destination.startsWith("<") || !destination.endsWith(">")) {
    return null;
  }
  return destination.slice(1, -1);
}

function findMarkdownBracketEnd(value: string, startIndex: number): number {
  let depth = 0;
  let cursor = startIndex;

  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "[") {
      depth += 1;
    } else if (value[cursor] === "]") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor += 1;
  }

  return -1;
}

function findMarkdownParenEnd(value: string, startIndex: number): number {
  let depth = 0;
  let cursor = startIndex;
  const targetStart = startIndex + 1;

  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      if (isWindowsPathSeparatorInMarkdownTarget(value, cursor, targetStart)) {
        cursor += 1;
        continue;
      }
      cursor += 2;
      continue;
    }
    if (value[cursor] === "(") {
      depth += 1;
    } else if (value[cursor] === ")") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor += 1;
  }

  return -1;
}

function isWindowsPathSeparatorInMarkdownTarget(
  value: string,
  index: number,
  targetStart: number,
) {
  return isWindowsAbsolutePath(value.slice(targetStart, index + 1));
}
