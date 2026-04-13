/**
 * Rich-text import / export helpers.
 *
 * All importers return an HTML string that TipTap can load directly via
 * editor.commands.setContent(html).
 *
 * All exporters accept an HTML string (obtained from TipTap via
 * editor.getHTML()) and produce the target format.
 *
 * Supported formats
 * ─────────────────
 *   Import  → Markdown (.md), RTF (.rtf), DOCX / Google Doc (.docx)
 *   Export  → Markdown (.md), DOCX (.docx)
 *
 * Dependencies (add to package.json):
 *   marked        – Markdown → HTML
 *   mammoth       – DOCX → HTML
 *   turndown      – HTML → Markdown
 *   docx          – Build DOCX from JS objects
 */

import { marked } from 'marked';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import {
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    Packer,
    AlignmentType,
    UnderlineType,
} from 'docx';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a Markdown string to TipTap-compatible HTML.
 */
export async function importMarkdown(markdownContent: string): Promise<string> {
    if (!markdownContent || typeof markdownContent !== 'string') {
        return '<p></p>';
    }
    const html = await marked(markdownContent, { async: false });
    return typeof html === 'string' ? html : String(html);
}

/**
 * Converts an RTF string to TipTap-compatible HTML.
 *
 * Uses a hand-rolled RTF stripper since npm RTF parsers are unreliable.
 * This handles:
 *   - Bold (\b), italic (\i), underline (\ul), strikethrough (\strike)
 *   - Paragraphs (\par, \pard)
 *   - Unicode escape sequences (\uN?)
 *   - Basic heading detection via \outlinelevel
 */
export function importRtf(rtfContent: string): string {
    if (!rtfContent || typeof rtfContent !== 'string') {
        return '<p></p>';
    }

    // Strip binary blobs ({\*\xxx ...}) and picture groups
    let text = rtfContent
        .replace(/\{\\pict[^}]*\}/gs, '')
        .replace(/\{\\\*[^}]*\}/gs, '');

    const paragraphs: string[] = [];
    let current = '';
    let bold = false;
    let italic = false;
    let underline = false;
    let strike = false;
    let headingLevel = 0;

    // Tokenise: control words, control symbols, literal text, groups
    const tokens = text.matchAll(/\\([a-z]+)(-?\d+)?[ ]?|\\([^a-z])|([^\\{}]+)|\{|\}/gi);

    for (const match of tokens) {
        const [full, word, param, ctrl, literal] = match;

        if (word) {
            const n = param !== undefined ? parseInt(param, 10) : undefined;
            switch (word) {
                case 'b':      bold = n !== 0; break;
                case 'i':      italic = n !== 0; break;
                case 'ul':     underline = n !== 0; break;
                case 'ulnone': underline = false; break;
                case 'strike': strike = n !== 0; break;
                case 'outlinelevel': headingLevel = n !== undefined ? n + 1 : 0; break;
                case 'par':
                case 'pard':
                    if (current.trim()) {
                        paragraphs.push(wrapParagraph(current.trim(), headingLevel));
                        current = '';
                    }
                    if (word === 'pard') headingLevel = 0;
                    break;
                case 'u': {
                    // RTF Unicode: \uN? — N is the Unicode code point
                    if (n !== undefined) {
                        current += String.fromCodePoint(n < 0 ? n + 65536 : n);
                    }
                    break;
                }
                case 'tab': current += '\t'; break;
                case 'line': current += '<br>'; break;
                // skip all other control words
            }
        } else if (ctrl) {
            if (ctrl === '\n' || ctrl === '\r') {
                // soft line break in RTF source — ignore
            } else if (ctrl === '\\') {
                current += '\\';
            } else if (ctrl === '{') {
                current += '{';
            } else if (ctrl === '}') {
                current += '}';
            }
        } else if (literal) {
            // Wrap with inline marks
            let span = escapeHtml(literal);
            if (strike)     span = `<s>${span}</s>`;
            if (underline)  span = `<u>${span}</u>`;
            if (italic)     span = `<em>${span}</em>`;
            if (bold)       span = `<strong>${span}</strong>`;
            current += span;
        }
    }

    if (current.trim()) {
        paragraphs.push(wrapParagraph(current.trim(), headingLevel));
    }

    return paragraphs.length > 0 ? paragraphs.join('\n') : '<p></p>';
}

function wrapParagraph(content: string, level: number): string {
    if (level >= 1 && level <= 6) {
        return `<h${level}>${content}</h${level}>`;
    }
    return `<p>${content}</p>`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Converts a DOCX buffer to TipTap-compatible HTML.
 *
 * Also handles Google Docs files — Google Docs exports to .docx format,
 * so this function works identically for both.
 */
export async function importDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.convertToHtml({ buffer });

    if (result.messages.length > 0) {
        const warnings = result.messages.filter(m => m.type === 'warning');
        if (warnings.length > 0) {
            console.warn('[importDocx] conversion warnings:', warnings.map(w => w.message));
        }
    }

    return result.value || '<p></p>';
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts TipTap HTML to a Markdown string.
 */
export function exportToMarkdown(htmlContent: string): string {
    if (!htmlContent || typeof htmlContent !== 'string') return '';

    const td = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
    });

    // TipTap uses <mark> for highlights — map to ==text== (common MD extension)
    td.addRule('highlight', {
        filter: 'mark',
        replacement: (content: string) => `==${content}==`,
    });

    return td.turndown(htmlContent);
}

/**
 * Converts TipTap HTML to a DOCX Buffer.
 *
 * Parses the HTML and maps common elements (headings, paragraphs, lists,
 * bold/italic/underline/strike inline marks) to docx.js primitives.
 */
export async function exportToDocx(htmlContent: string): Promise<Buffer> {
    const children = htmlToDocxParagraphs(htmlContent);

    const doc = new Document({
        sections: [{ children }],
    });

    return Packer.toBuffer(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal HTML → docx.js converter
// ─────────────────────────────────────────────────────────────────────────────

type DocxChild = Paragraph;

interface InlineStyle {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    code?: boolean;
}

function htmlToDocxParagraphs(html: string): DocxChild[] {
    // Lightweight block-level splitter — split on block tags
    const blocks: DocxChild[] = [];

    // Normalise self-closing tags and line endings
    const clean = html.replace(/\r\n?/g, '\n').trim();

    // Split into block segments by matching opening/closing block tags
    const blockPattern = /<(h[1-6]|p|li|blockquote|pre|div|br\s*\/?)[^>]*>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(clean)) !== null) {
        const [full, tag, innerHtml] = match;

        if (!tag || tag.toLowerCase().startsWith('br')) {
            blocks.push(new Paragraph({ children: [] }));
            continue;
        }

        const tagLower = tag.toLowerCase();
        let headingLevel: typeof HeadingLevel[keyof typeof HeadingLevel] | undefined;

        if (tagLower === 'h1') headingLevel = HeadingLevel.HEADING_1;
        else if (tagLower === 'h2') headingLevel = HeadingLevel.HEADING_2;
        else if (tagLower === 'h3') headingLevel = HeadingLevel.HEADING_3;
        else if (tagLower === 'h4') headingLevel = HeadingLevel.HEADING_4;
        else if (tagLower === 'h5') headingLevel = HeadingLevel.HEADING_5;
        else if (tagLower === 'h6') headingLevel = HeadingLevel.HEADING_6;

        const runs = parseInlineHtml(innerHtml ?? '', {});

        blocks.push(new Paragraph({
            heading: headingLevel,
            children: runs,
        }));

        lastIndex = blockPattern.lastIndex;
    }

    // If nothing matched (plain text or only inline), treat the whole thing as one paragraph
    if (blocks.length === 0) {
        const runs = parseInlineHtml(clean, {});
        blocks.push(new Paragraph({ children: runs }));
    }

    return blocks;
}

function parseInlineHtml(html: string, baseStyle: InlineStyle): TextRun[] {
    const runs: TextRun[] = [];
    // Strip remaining tags while collecting style context
    const inlinePattern = /<(\/?)(\w+)[^>]*>|([^<]+)/g;
    const styleStack: InlineStyle[] = [{ ...baseStyle }];
    let current = () => styleStack[styleStack.length - 1];

    let m: RegExpExecArray | null;
    while ((m = inlinePattern.exec(html)) !== null) {
        const [, closing, tag, text] = m;

        if (text) {
            const decoded = decodeHtmlEntities(text);
            if (decoded) {
                const s = current();
                runs.push(new TextRun({
                    text: decoded,
                    bold: s.bold,
                    italics: s.italic,
                    underline: s.underline ? { type: UnderlineType.SINGLE } : undefined,
                    strike: s.strike,
                }));
            }
        } else if (tag) {
            const t = tag.toLowerCase();
            if (closing) {
                if (styleStack.length > 1) styleStack.pop();
            } else {
                const prev = current();
                const next: InlineStyle = { ...prev };
                if (t === 'strong' || t === 'b') next.bold = true;
                else if (t === 'em' || t === 'i') next.italic = true;
                else if (t === 'u') next.underline = true;
                else if (t === 's' || t === 'strike' || t === 'del') next.strike = true;
                else if (t === 'code') next.code = true;
                styleStack.push(next);
            }
        }
    }

    return runs;
}

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
