/** The markup languages a document can be written in. Vale reads each one differently. */
export const DOCUMENT_FORMATS = ['markdown', 'asciidoc'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DEFAULT_FORMAT: DocumentFormat = 'markdown';

export function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === 'string' && (DOCUMENT_FORMATS as readonly string[]).includes(value);
}

/** File extension of the temporary file Vale reads; it decides which `[*.ext]` section applies. */
export function getFileExtension(format: DocumentFormat): string {
  return format === 'asciidoc' ? 'adoc' : 'md';
}

const ASCIIDOC_EXTENSIONS = ['.adoc', '.asciidoc', '.asc'];
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

/** The format a file name suggests, or null when the extension says nothing. */
export function detectFormat(fileName: string): DocumentFormat | null {
  const name = fileName.toLowerCase();
  if (ASCIIDOC_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'asciidoc';
  if (MARKDOWN_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'markdown';
  return null;
}

/** Value of the `accept` attribute of the file picker for documents. */
export const DOCUMENT_ACCEPT = [...MARKDOWN_EXTENSIONS, ...ASCIIDOC_EXTENSIONS].join(',');
