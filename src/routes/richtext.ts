/**
 * Rich-text import / export routes.
 *
 * Import endpoints receive a file upload and return TipTap-compatible HTML.
 * Export endpoints receive an HTML body and return the target file format.
 *
 * All import routes expect multipart/form-data with a single field named "file".
 * All export routes expect Content-Type: application/json with { "html": "..." }.
 */

import express from 'express';
import multer from 'multer';
import {
    importMarkdown,
    importRtf,
    importDocx,
    exportToMarkdown,
    exportToDocx,
} from '../db/richtext-functions';

const router = express.Router();

// Use memory storage — we never write upload files to disk
const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/richtext/import/markdown
 * Body: multipart/form-data, field "file" (.md file)
 * Returns: { html: string }
 */
router.post('/import/markdown', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Send a .md file in the "file" field.' });
    }

    try {
        const content = req.file.buffer.toString('utf-8');
        const html = await importMarkdown(content);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert Markdown', detail: String(err) });
    }
});

/**
 * POST /api/richtext/import/rtf
 * Body: multipart/form-data, field "file" (.rtf file)
 * Returns: { html: string }
 */
router.post('/import/rtf', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Send a .rtf file in the "file" field.' });
    }

    try {
        const content = req.file.buffer.toString('latin1'); // RTF files use latin-1 / windows-1252
        const html = importRtf(content);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert RTF', detail: String(err) });
    }
});

/**
 * POST /api/richtext/import/docx
 * Body: multipart/form-data, field "file" (.docx file)
 * Returns: { html: string }
 *
 * Also handles Google Docs files — Google Docs exports to .docx format,
 * so this endpoint works for both.
 */
router.post('/import/docx', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Send a .docx file in the "file" field.' });
    }

    try {
        const html = await importDocx(req.file.buffer);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'Failed to convert DOCX', detail: String(err) });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/richtext/export/markdown
 * Body: { "html": "<p>Your TipTap HTML...</p>" }
 * Returns: text/markdown file download
 */
router.post('/export/markdown', (req, res) => {
    const { html } = req.body;
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "html" field in request body.' });
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

/**
 * POST /api/richtext/export/docx
 * Body: { "html": "<p>Your TipTap HTML...</p>" }
 * Returns: application/vnd.openxmlformats-officedocument.wordprocessingml.document file download
 *
 * The resulting file is compatible with Microsoft Word and Google Docs.
 */
router.post('/export/docx', async (req, res) => {
    const { html } = req.body;
    if (!html || typeof html !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "html" field in request body.' });
    }

    try {
        const buffer = await exportToDocx(html);
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader('Content-Disposition', 'attachment; filename="export.docx"');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: 'Failed to export DOCX', detail: String(err) });
    }
});

export default router;
