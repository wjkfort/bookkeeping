import React from "react";

/**
 * The chat log's markdown, kept deliberately small.
 *
 * The model writes markdown whether or not it was asked to — measured in the
 * stored replies: `**bold**` in three of them, `- ` and `1. ` lists in most. The
 * bubble rendered `{m.content}` as a single text node, so those asterisks reached
 * the user literally. This covers the inline forms that actually appear.
 *
 * What it deliberately does NOT do:
 *
 *   - **No HTML, ever.** The parser returns React nodes, so there is nothing to
 *     sanitise and no `dangerouslySetInnerHTML`: a reply containing
 *     `<img onerror=…>` is text, and stays text.
 *   - **No `_emphasis_`.** Tool and column names in this app are snake_case
 *     (`unit_raw`, `item_id`), and one reply mentioning two of them would turn
 *     everything between the underscores italic. `*` only.
 *   - **No lists, headings or tables.** Line breaks already survive the bubble's
 *     `white-space: pre-wrap`, and a `- ` line reads as a bullet on its own.
 *     Structure nobody asked for is not worth a parser.
 *
 * Emphasis also has to be *tight*: no space directly inside either marker. That
 * is what keeps arithmetic — "3 * 4 * 5" — from turning into italics.
 */

export type MarkdownToken =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "code"; value: string };

/**
 * One pass, three alternatives, in precedence order: `**strong**` before
 * `` `code` `` before `*em*`. Inner runs exclude `*` and newlines, so a marker
 * cannot reach across a line or swallow its neighbour.
 */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

/** A marker pair is only emphasis when it hugs its text. */
const isTight = (inner: string): boolean =>
  inner.length > 0 && !/^\s/.test(inner) && !/\s$/.test(inner);

/**
 * Split one message into text and emphasis runs.
 *
 * Exported because it is the whole of the logic: the component below only maps
 * tokens onto elements, so a test (or a scratch check) can exercise the parsing
 * without React.
 */
export function parseInline(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE)) {
    const raw = match[0];
    const at = match.index ?? 0;

    let token: MarkdownToken | null = null;
    if (raw.startsWith("**")) {
      const inner = raw.slice(2, -2);
      if (isTight(inner)) token = { kind: "strong", value: inner };
    } else if (raw.startsWith("`")) {
      // Code spans are literal by definition, so tightness does not apply.
      token = { kind: "code", value: raw.slice(1, -1) };
    } else {
      const inner = raw.slice(1, -1);
      if (isTight(inner)) token = { kind: "em", value: inner };
    }

    // Not emphasis after all ("3 * 4 * 5"): leave it inside the text run.
    if (!token) continue;

    if (at > cursor) tokens.push({ kind: "text", value: text.slice(cursor, at) });
    tokens.push(token);
    cursor = at + raw.length;
  }

  if (cursor < text.length) tokens.push({ kind: "text", value: text.slice(cursor) });
  return tokens;
}

/**
 * Render one message. Newlines need no handling here — the bubble sets
 * `white-space: pre-wrap`, and these elements are inline, so they inherit it.
 */
export const MiniMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseInline(text).map((token, index) => {
      switch (token.kind) {
        case "strong":
          return <strong key={index}>{token.value}</strong>;
        case "em":
          return <em key={index}>{token.value}</em>;
        case "code":
          return <code key={index}>{token.value}</code>;
        default:
          return <React.Fragment key={index}>{token.value}</React.Fragment>;
      }
    })}
  </>
);

export default MiniMarkdown;
