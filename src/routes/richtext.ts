/**
 * Rich-text import / export routes.
 *
 * Import  → Word (.docx), RTF (.rtf), Markdown (.md)
 * Export  → Word (.docx), Markdown (.md)
 *
 * All import routes accept JSON: { content: string, encoding: "base64" | "utf8" }
 * All export routes accept JSON: { html: string }
 */

import express from 'express';
import {
    importMarkdown,
    importRtf,
    importDocx,
    exportToMarkdown,
    exportToDocx,
} from '../db/richtext-functions';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/richtext/import/docx — Word document */
router.post('/import/docx', async (req, res) => {
    const { content, encoding = 'base64' } = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing "content" field.' });
    }
    try {
        const buffer = Buffer.from(content, encoding as BufferEncoding);
        const html = await importDocx(buffer);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert DOCX', detail: String(err) });
    }
});

/** POST /api/richtext/import/rtf — Rich Text Format */
router.post('/import/rtf', (req, res) => {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing "content" field.' });
    }
    try {
        const html = importRtf(content);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert RTF', detail: String(err) });
    }
});

/** POST /api/richtext/import/markdown — Markdown */
router.post('/import/markdown', async (req, res) => {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing "content" field.' });
    }
    try {
        const html = await importMarkdown(content);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert Markdown', detail: String(err) });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/richtext/export/docx — Word document */
router.post('/export/docx', async (req, res) => {
    const { html } = req.body;
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Missing "html" field.' });
    }
    try {
        const buffer = await exportToDocx(html);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="export.docx"');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: 'Failed to export DOCX', detail: String(err) });
    }
});

/** POST /api/richtext/export/markdown — Markdown */
router.post('/export/markdown', (req, res) => {
    const { html } = req.body;
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Missing "html" field.' });
    }
    try {
        const markdown = exportToMarkdown(html);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="export.md"');
        res.send(markdown);
    } catch (err) {
        res.status(500).json({ error: 'Failed to export Markdown', detail: String(err) });
    }
});

export default router;
