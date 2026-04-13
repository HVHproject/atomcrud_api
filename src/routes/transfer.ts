/**
 * Transfer routes: copy rows/columns between tables, get column mapping suggestions.
 *
 * Column mapping endpoint:
 *   POST /api/database/:dbId/table/:tableName/mapping
 *   Body: { targetDbId, targetTableName, overrides?: { targetCol: sourceCol } }
 *   Returns: array of ColumnMappingEntry (suggestions for how to map columns)
 *
 * Row copy endpoint:
 *   POST /api/database/:dbId/table/:tableName/row/copy
 *   Body: { targetDbId, targetTableName, rowIds: number[] | 'all', columnMapping: [...] }
 *   Returns: { copied, skipped, errors }
 *
 * Column copy endpoint:
 *   POST /api/database/:dbId/table/:tableName/column/:columnName/copy
 *   Body: { targetDbId, targetTableName, targetColumnName?, overwrite? }
 *   Returns: { success }
 */

import express from 'express';
import { buildColumnMapping, copyRows, copyColumn } from '../db/transfer-functions';
import { getAllColumns } from '../db/column-functions';

const router = express.Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────────────────────
// GET column mapping suggestion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/database/:dbId/table/:tableName/mapping
 *
 * Returns a suggested column mapping from :tableName (source) to targetTableName.
 * Optionally accepts manual overrides to pin specific column pairings.
 *
 * Body:
 *   targetDbId       string   – target database id (defaults to same database)
 *   targetTableName  string   – target table name (required)
 *   overrides        object   – optional { targetColumn: sourceColumn } pin map
 *
 * Response:
 *   Array of ColumnMappingEntry objects describing each target column's
 *   best source match and compatibility level.
 */
router.post('/:dbId/table/:tableName/mapping', (req, res) => {
    const { dbId, tableName } = req.params;
    const { targetDbId, targetTableName, overrides } = req.body;

    if (!targetTableName || typeof targetTableName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "targetTableName"' });
    }

    const resolvedTargetDb = targetDbId || dbId;

    try {
        const sourceColumns = getAllColumns(dbId, tableName);
        const targetColumns = getAllColumns(resolvedTargetDb, targetTableName);
        const mapping = buildColumnMapping(sourceColumns, targetColumns, overrides ?? {});
        res.json({ mapping });
    } catch (err) {
        res.status(500).json({ error: 'Failed to build column mapping', detail: String(err) });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Copy rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/database/:dbId/table/:tableName/row/copy
 *
 * Copies rows from :tableName to targetTableName, transforming values
 * according to the supplied columnMapping.
 *
 * Body:
 *   targetDbId       string                              – defaults to same db
 *   targetTableName  string                              – required
 *   rowIds           number[] | 'all'                    – required
 *   columnMapping    { sourceColumn, targetColumn }[]    – required
 *
 * Use the /mapping endpoint first to get a suggested columnMapping,
 * then pass it here (with any manual adjustments).
 */
router.post('/:dbId/table/:tableName/row/copy', (req, res) => {
    const { dbId, tableName } = req.params;
    const { targetDbId, targetTableName, rowIds, columnMapping } = req.body;

    if (!targetTableName || typeof targetTableName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "targetTableName"' });
    }
    if (!rowIds) {
        return res.status(400).json({ error: '"rowIds" is required (array of ids or "all")' });
    }
    if (!Array.isArray(columnMapping) || columnMapping.length === 0) {
        return res.status(400).json({ error: '"columnMapping" must be a non-empty array of { sourceColumn, targetColumn } pairs' });
    }

    const resolvedTargetDb = targetDbId || dbId;

    try {
        const result = copyRows(
            dbId,
            tableName,
            rowIds,
            resolvedTargetDb,
            targetTableName,
            columnMapping
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to copy rows', detail: String(err) });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Copy column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/database/:dbId/table/:tableName/column/:columnName/copy
 *
 * Copies a column definition and all its row data to another table.
 * Works within the same database or across databases.
 *
 * Body:
 *   targetDbId        string   – defaults to same db
 *   targetTableName   string   – required
 *   targetColumnName  string   – optional; defaults to sourceColumnName
 *   overwrite         boolean  – optional; if true, replaces an existing column
 */
router.post('/:dbId/table/:tableName/column/:columnName/copy', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { targetDbId, targetTableName, targetColumnName, overwrite } = req.body;

    if (!targetTableName || typeof targetTableName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "targetTableName"' });
    }

    const resolvedTargetDb = targetDbId || dbId;

    try {
        copyColumn(
            dbId,
            tableName,
            columnName,
            resolvedTargetDb,
            targetTableName,
            targetColumnName,
            { overwrite: Boolean(overwrite) }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to copy column', detail: String(err) });
    }
});

export default router;
