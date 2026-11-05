import React, {useMemo} from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {decodeHtmlEntities} from '@/utils';

/**
 * RichText
 *
 * Renders the constrained HTML the backend stores for simulation copy as native
 * RN text/views — the mobile counterpart of the web RichTextRenderer. Supports
 * the same tag set: p, h1-h3, ul, ol, li, blockquote, hr, br and the inline
 * marks strong/b, em/i, u, s. Unknown tags are unwrapped (their children still
 * render) and script/style subtrees are dropped. Plain text without any tags is
 * rendered as a single paragraph, matching the web's <p> fallback.
 *
 * Note: RN does not execute HTML, so there is no script-injection surface here.
 */

type HtmlTextNode = {type: 'text'; value: string};
type HtmlElementNode = {type: 'element'; tag: string; children: HtmlNode[]};
type HtmlNode = HtmlTextNode | HtmlElementNode;

const INLINE_TAGS = new Set([
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'br',
  'span',
  'a',
]);
const SKIP_TAGS = new Set(['script', 'style']);
const VOID_TAGS = new Set(['br', 'hr', 'img']);

const INLINE_STYLE: Record<string, StyleProp<TextStyle>> = {
  strong: {fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily},
  b: {fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily},
  em: {fontStyle: 'italic'},
  i: {fontStyle: 'italic'},
  u: {textDecorationLine: 'underline'},
  s: {textDecorationLine: 'line-through'},
  strike: {textDecorationLine: 'line-through'},
};

/**
 * Parse a (small, trusted) HTML string into a node tree. Tolerant of unclosed
 * and mismatched tags: a close tag pops up to its nearest matching open tag.
 */
const parseHtml = (html: string): HtmlElementNode => {
  const root: HtmlElementNode = {type: 'element', tag: 'root', children: []};
  const stack: HtmlElementNode[] = [root];
  const tokenizer = /<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>|([^<]+)/g;

  let match: RegExpExecArray | null;
  while ((match = tokenizer.exec(html)) !== null) {
    const [, closing, rawTag, selfClosing, text] = match;

    if (text !== undefined) {
      stack[stack.length - 1].children.push({type: 'text', value: text});
      continue;
    }

    const tag = rawTag.toLowerCase();

    if (closing === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: HtmlElementNode = {type: 'element', tag, children: []};
    stack[stack.length - 1].children.push(node);
    if (selfClosing !== '/' && !VOID_TAGS.has(tag)) {
      stack.push(node);
    }
  }

  return root;
};

const isBlockChild = (node: HtmlNode): boolean =>
  node.type === 'element' &&
  !INLINE_TAGS.has(node.tag) &&
  !SKIP_TAGS.has(node.tag);

/** Whitespace-only text, or a paragraph that holds nothing but whitespace. */
const isBlankNode = (node: HtmlNode): boolean => {
  if (node.type === 'text') return node.value.trim().length === 0;
  return node.tag === 'p' && node.children.every(isBlankNode);
};

const renderInline = (
  nodes: HtmlNode[],
  keyPrefix: string,
): React.ReactNode[] =>
  nodes.flatMap<React.ReactNode>((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === 'text') {
      // Collapse HTML whitespace runs the way a browser would.
      return [decodeHtmlEntities(node.value).replace(/\s+/g, ' ')];
    }
    if (SKIP_TAGS.has(node.tag)) return [];
    if (node.tag === 'br') return ['\n'];
    return [
      <Text key={key} style={INLINE_STYLE[node.tag]}>
        {renderInline(node.children, key)}
      </Text>,
    ];
  });

type RichTextVariant = 'light' | 'dark';

// Dark-background override (roleplay screen's Session Info panel, bg #1D2020)
// — light variant/callers are untouched (style arrays drop falsy entries).
const darkOverrides = StyleSheet.create({
  text: {color: '#D9D9DC'},
  hr: {backgroundColor: '#3D4045'},
  blockquote: {borderLeftColor: '#3D4045'},
});

const renderListItem = (
  item: HtmlElementNode,
  ordered: boolean,
  index: number,
  key: string,
  variant: RichTextVariant,
  textStyle?: StyleProp<TextStyle>,
): React.ReactNode => {
  const itemBody = item.children.some(isBlockChild) ? (
    renderBlocks(item.children, key, variant, textStyle)
  ) : (
    <Text
      style={[
        styles.listItemText,
        variant === 'dark' && darkOverrides.text,
        textStyle,
      ]}>
      {renderInline(item.children, key)}
    </Text>
  );

  return (
    <View key={key} style={styles.listItem}>
      <Text
        style={[
          styles.listMarker,
          variant === 'dark' && darkOverrides.text,
          textStyle,
        ]}>
        {ordered ? `${index + 1}.` : '•'}
      </Text>
      <View style={styles.listItemContent}>{itemBody}</View>
    </View>
  );
};

const renderBlockElement = (
  node: HtmlElementNode,
  key: string,
  variant: RichTextVariant,
  textStyle?: StyleProp<TextStyle>,
): React.ReactNode => {
  const baseTextStyle = [variant === 'dark' && darkOverrides.text, textStyle];
  switch (node.tag) {
    case 'h1':
      return (
        <Text key={key} style={[styles.h1, ...baseTextStyle, headingFont.h1]}>
          {renderInline(node.children, key)}
        </Text>
      );
    case 'h2':
      return (
        <Text key={key} style={[styles.h2, ...baseTextStyle, headingFont.h2]}>
          {renderInline(node.children, key)}
        </Text>
      );
    case 'h3':
      return (
        <Text key={key} style={[styles.h3, ...baseTextStyle, headingFont.h3]}>
          {renderInline(node.children, key)}
        </Text>
      );
    case 'hr':
      return (
        <View
          key={key}
          style={[styles.hr, variant === 'dark' && darkOverrides.hr]}
        />
      );
    case 'blockquote':
      return (
        <View
          key={key}
          style={[
            styles.blockquote,
            variant === 'dark' && darkOverrides.blockquote,
          ]}>
          {renderBlocks(node.children, key, variant, textStyle)}
        </View>
      );
    case 'ul':
    case 'ol': {
      const ordered = node.tag === 'ol';
      const items = node.children.filter(
        (child): child is HtmlElementNode =>
          child.type === 'element' && child.tag === 'li',
      );
      return (
        <View key={key} style={styles.list}>
          {items.map((item, index) =>
            renderListItem(
              item,
              ordered,
              index,
              `${key}-${index}`,
              variant,
              textStyle,
            ),
          )}
        </View>
      );
    }
    case 'p':
      return (
        <Text key={key} style={[styles.paragraph, ...baseTextStyle]}>
          {renderInline(node.children, key)}
        </Text>
      );
    default:
      // Unknown wrappers (e.g. div, section) are unwrapped.
      return (
        <React.Fragment key={key}>
          {renderBlocks(node.children, key, variant, textStyle)}
        </React.Fragment>
      );
  }
};

function renderBlocks(
  nodes: HtmlNode[],
  keyPrefix: string,
  variant: RichTextVariant,
  textStyle?: StyleProp<TextStyle>,
): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  let inlineBuffer: HtmlNode[] = [];
  let paragraphCount = 0;

  // Editors leave an empty <p></p> after the last line. It renders as a blank
  // paragraph and its margin, so drop trailing ones (a blank line in the middle
  // is a spacer the author chose, and stays).
  let end = nodes.length;
  while (end > 0 && isBlankNode(nodes[end - 1])) end--;
  nodes = nodes.slice(0, end);

  const flushInline = () => {
    const hasContent = inlineBuffer.some(
      node =>
        node.type === 'element' ||
        (node.type === 'text' && node.value.trim().length > 0),
    );
    if (hasContent) {
      const key = `${keyPrefix}-p-${paragraphCount++}`;
      blocks.push(
        <Text
          key={key}
          style={[
            styles.paragraph,
            variant === 'dark' && darkOverrides.text,
            textStyle,
          ]}>
          {renderInline(inlineBuffer, key)}
        </Text>,
      );
    }
    inlineBuffer = [];
  };

  nodes.forEach((node, index) => {
    if (node.type === 'text') {
      inlineBuffer.push(node);
      return;
    }
    if (SKIP_TAGS.has(node.tag)) return;
    if (INLINE_TAGS.has(node.tag)) {
      inlineBuffer.push(node);
      return;
    }
    flushInline();
    blocks.push(
      renderBlockElement(node, `${keyPrefix}-${index}`, variant, textStyle),
    );
  });

  flushInline();
  return blocks;
}

export interface RichTextProps {
  html: string | undefined | null;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** 'dark' recolors text for dark backgrounds (e.g. the roleplay screen's
   * Session Info panel). Defaults to 'light' — the original light-background
   * behavior used by the pre-practice scenario details screen. */
  variant?: RichTextVariant;
}

export const RichText: React.FC<RichTextProps> = ({
  html,
  style,
  textStyle,
  variant = 'light',
}) => {
  const blocks = useMemo(() => {
    if (!html || html.trim().length === 0) return null;
    return renderBlocks(parseHtml(html).children, 'rt', variant, textStyle);
  }, [html, variant, textStyle]);

  if (!blocks || blocks.length === 0) return null;

  return <View style={style}>{blocks}</View>;
};

const styles = ScaledSheet.create({
  paragraph: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    color: colors.darkCharcoal,
    fontSize: '14@ms',
    lineHeight: '22@ms',
    marginBottom: '8@ms',
  },
  h1: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
    color: colors.black,
    fontSize: '20@ms',
    lineHeight: '28@ms',
    marginTop: '8@ms',
    marginBottom: '6@ms',
  },
  h2: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
    color: colors.black,
    fontSize: '18@ms',
    lineHeight: '26@ms',
    marginTop: '8@ms',
    marginBottom: '4@ms',
  },
  h3: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
    color: colors.black,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    marginTop: '6@ms',
    marginBottom: '4@ms',
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.lightGray5,
    marginVertical: '12@ms',
  },
  blockquote: {
    borderLeftWidth: '3@ms',
    borderLeftColor: colors.lightGray5,
    paddingLeft: '12@ms',
    marginVertical: '8@ms',
  },
  list: {
    marginBottom: '8@ms',
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: '4@ms',
    paddingRight: '8@ms',
  },
  listMarker: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    color: colors.darkCharcoal,
    fontSize: '14@ms',
    lineHeight: '22@ms',
    marginRight: '8@ms',
    minWidth: '14@ms',
  },
  listItemContent: {
    flex: 1,
  },
  listItemText: {
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    color: colors.darkCharcoal,
    fontSize: '14@ms',
    lineHeight: '22@ms',
  },
});

/**
 * A caller's `textStyle` (the journal's body font, say) is applied after the
 * heading style so it can set the colour, which also flattened the heading's
 * font, weight and size to body text. Re-assert only those, last.
 */
const headingFont = (['h1', 'h2', 'h3'] as const).reduce(
  (acc, tag) => {
    const {fontSize, lineHeight} = StyleSheet.flatten(styles[tag]);
    acc[tag] = {
      ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
      fontSize,
      lineHeight,
    };
    return acc;
  },
  {} as Record<'h1' | 'h2' | 'h3', TextStyle>,
);
