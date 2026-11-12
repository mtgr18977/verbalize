import { StreamLanguage, LanguageSupport } from '@codemirror/language';
import type { StreamParser } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * AsciiDoc highlighting for the editor, as a small line-oriented parser.
 *
 * It colors structure (titles, delimited blocks, attributes, lists, admonitions) and the inline
 * marks writers see most (strong, emphasis, monospace, links, attribute references). It is not a
 * full AsciiDoc grammar: Asciidoctor is what actually reads the document, and Vale reports from
 * its output. CodeMirror's own Markdown support is far bigger than needed here, so there is no
 * AsciiDoc package to add: this is a few dozen lines.
 */

interface AsciidocState {
  /** Inside a delimited block whose content is not markup: comment (////) or code (----, ...., ++++). */
  block: { kind: 'comment' | 'code'; delimiter: string } | null;
}

const WORD_BOUNDARY_BEFORE = /[\s([{>"'`-]/;

const parser: StreamParser<AsciidocState> = {
  name: 'asciidoc',

  startState: () => ({ block: null }),

  copyState: (state) => ({ block: state.block }),

  token(stream, state) {
    if (stream.sol()) {
      const line = stream.string.trimEnd();

      if (state.block) {
        const closes = line === state.block.delimiter;
        const kind = state.block.kind;
        stream.skipToEnd();
        if (closes) {
          state.block = null;
          return 'meta';
        }
        return kind === 'comment' ? 'comment' : 'monospace';
      }

      if (/^\/{4,}$/.test(line)) {
        state.block = { kind: 'comment', delimiter: line };
        stream.skipToEnd();
        return 'comment';
      }
      if (/^(-{4,}|\.{4,}|\+{4,})$/.test(line)) {
        state.block = { kind: 'code', delimiter: line };
        stream.skipToEnd();
        return 'meta';
      }
      if (/^\/\//.test(line)) {
        stream.skipToEnd();
        return 'comment';
      }
      if (/^={1,6}\s+\S/.test(line)) {
        stream.skipToEnd();
        return 'heading';
      }
      // Other delimiters, attribute entries, block attributes, block titles and block macros
      if (
        /^(={4,}|\*{4,}|_{4,}|--|\|={3,})$/.test(line) ||
        /^:[\w-]+!?:/.test(line) ||
        /^\[[^\]]*\]$/.test(line) ||
        /^\.[^\s.]/.test(line) ||
        /^(include|image|video|audio|toc)::/.test(line)
      ) {
        stream.skipToEnd();
        return 'meta';
      }
      if (stream.match(/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):(?=\s)/)) return 'strong';
      if (stream.match(/^\s*(\*{1,5}|-|\.{1,5}|\d+\.|[a-z]\.)\s/)) return 'meta';
    }

    const before = stream.pos > 0 ? stream.string[stream.pos - 1] : ' ';
    const atBoundary = WORD_BOUNDARY_BEFORE.test(before);

    if (atBoundary && stream.match(/^\*\*?[^*\s](?:[^*]*[^*\s])?\*\*?(?![\w*])/)) return 'strong';
    if (atBoundary && stream.match(/^__?[^_\s](?:[^_]*[^_\s])?__?(?![\w_])/)) return 'emphasis';
    if (stream.match(/^`[^`]+`/) || (atBoundary && stream.match(/^\+[^+\s](?:[^+]*[^+\s])?\+(?![\w+])/))) return 'monospace';
    if (stream.match(/^https?:\/\/[^\s[]+/)) return 'url';
    if (atBoundary && stream.match(/^[a-z]+:[^\s[:]*\[[^\]]*\]/)) return 'link';
    if (stream.match(/^<<[^>]+>>/)) return 'link';
    if (stream.match(/^\{[\w-]+\}/)) return 'meta';

    // Nothing special here: move to the next place where something could start
    if (!stream.eatWhile(/[^\s*_`+<{:hs]/)) stream.next();
    return null;
  },

  tokenTable: {
    heading: tags.heading,
    strong: tags.strong,
    emphasis: tags.emphasis,
    monospace: tags.monospace,
    comment: tags.comment,
    meta: tags.meta,
    link: tags.link,
    url: tags.url,
  },
};

export const asciidocLanguage = StreamLanguage.define(parser);

export function asciidoc(): LanguageSupport {
  return new LanguageSupport(asciidocLanguage);
}
