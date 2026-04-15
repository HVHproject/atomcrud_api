import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDbPaths } from '../utils/db-paths';

const router = express.Router({ mergeParams: true });

/**
 * Multer disk storage that writes uploaded files to:
 *   Gallery/{tableName}/{rowId}/
 * inside the database's gallery folder.
 *
 * The folder is created on demand if it doesn't exist.
 * Filenames are sanitized to strip illegal path characters while
 * preserving the original name and extension.
 */
const storage = multer.diskStorage({
    destination(req, _file, cb) {
        const { dbId, tableName, rowId } = req.params as Record<string, string>;
        const { galleryPath } = getDbPaths(dbId);
        const uploadDir = path.join(galleryPath, tableName, rowId);
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename(_req, file, cb) {
        // Strip path separators and shell-dangerous characters; keep the rest as-is.
        const safe = file.originalname.replace(/[/\\?%*:|"<>]/g, '_');
        cb(null, safe);
    },
});

const upload = multer({ storage });

/**
 * POST /api/database/:dbId/table/:tableName/row/:rowId/upload
 *
 * Accepts one or more files under the multipart field name "files".
 * Stores them at:
 *   {db_folder}/Gallery/{tableName}/{rowId}/
 *
 * Response (201):
 * {
 *   folderPath: string,        // absolute path to the cell's upload folder
 *   files: [{
 *     filename: string,        // stored filename
 *     path:     string,        // absolute path to the file
 *     size:     number,        // bytes
 *     mimetype: string
 *   }]
 * }
 *
 * The front end can convert folderPath / path to a file:// URI as needed.
 * For a single upload the URI is file:///{path}; for multiple uploads
 * pointing at the folder itself works: file:///{folderPath}.
 */
router.post(
    '/:dbId/table/:tableName/row/:rowId/upload',
    upload.array('files'),
    (req, res) => {
        const { dbId, tableName, rowId } = req.params;
        const { galleryPath } = getDbPaths(dbId);
        const folderPath = path.join(galleryPath, tableName, rowId);

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files received. Send files under the "files" field.' });
        }

        res.status(201).json({
            folderPath,
            files: files.map((f) => ({
                filename: f.filename,
                path:     f.path,
                size:     f.size,
                mimetype: f.mimetype,
            })),
        });
    }
);

/**
 * GET /api/database/:dbId/table/:tableName/row/:rowId/upload
 *
 * Lists all files currently in the cell's upload folder.
 * Returns an empty array if the folder doesn't exist yet.
 *
 * Response (200):
 * {
 *   folderPath: string,
 *   files: [{ filename: string, path: string, size: number }]
 * }
 */
router.get(
    '/:dbId/table/:tableName/row/:rowId/upload',
    (req, res) => {
        const { dbId, tableName, rowId } = req.params;
        const { galleryPath } = getDbPaths(dbId);
        const folderPath = path.join(galleryPath, tableName, rowId);

        if (!fs.existsSync(folderPath)) {
            return res.json({ folderPath, files: [] });
        }

        const entries = fs.readdirSync(folderPath, { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => {
                const filePath = path.join(folderPath, e.name);
                const { size } = fs.statSync(filePath);
                return { filename: e.name, path: filePath, size };
            });

        res.json({ folderPath, files: entries });
    }
);

/**
 * DELETE /api/database/:dbId/table/:tableName/row/:rowId/upload/:filename
 *
 * Removes a single file from the cell's upload folder.
 * Returns 404 if the file doesn't exist.
 */
router.delete(
    '/:dbId/table/:tableName/row/:rowId/upload/:filename',
    (req, res) => {
        const { dbId, tableName, rowId, filename } = req.params;

        // Reject any path traversal attempts
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            return res.status(400).json({ error: 'Invalid filename.' });
        }

        const { galleryPath } = getDbPaths(dbId);
        const filePath = path.join(galleryPath, tableName, rowId, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `File "${filename}" not found.` });
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, deleted: filename });
    }
);

export default router;
