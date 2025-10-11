import express from 'express';
import { copyTable, createTable, deleteTable, getTable, renameTable, setTableVisibility } from '../db/table-functions';

const router = express.Router({ mergeParams: true });

// Create a new table in an existing database
router.post('/:dbId/table', (req, res) => {
    const { dbId } = req.params;
    const { tableName } = req.body;

    if (!tableName || typeof tableName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "tableName"' });
    }

    try {
        createTable(dbId, tableName);
        res.status(201).json({ success: true, table: tableName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create table', detail: String(err) });
    }
});

// POST copy a table
router.post('/:sourceDbId/table/:sourceTableName/copy', (req, res) => {
    const { sourceDbId, sourceTableName } = req.params;
    const { targetDbId, newTableName } = req.body;

    try {
        copyTable(sourceDbId, sourceTableName, targetDbId || sourceDbId, newTableName);
        res.status(201).json({
            success: true,
            message: `Table '${sourceTableName}' copied to '${targetDbId || sourceDbId}' as '${newTableName || sourceTableName + '_copy'}'`,
        });
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

// Get rows of a table in a specific database
router.get('/:dbId/table/:tableName', (req, res) => {
    const { dbId, tableName } = req.params;
    const { offset, limit, hidden, q, s } = req.query;

    const offsetNum = offset ? parseInt(offset as string, 10) : undefined;
    const limitNum = limit ? parseInt(limit as string, 10) : undefined;

    let hiddenFlag: boolean | undefined;
    if (hidden === 'true') hiddenFlag = true;
    else if (hidden === 'false') hiddenFlag = false;

    try {
        const table = getTable(dbId, tableName, {
            offset: offsetNum,
            limit: limitNum,
            hidden: hiddenFlag,
            search: q as string | undefined,
            sort: s as string | undefined
        });
        res.json({ table: tableName, ...table });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch table rows', detail: String(err) });
    }
});


// Renames Table
router.patch('/:dbId/table/:tableName', (req, res) => {
    const { dbId, tableName } = req.params;
    const { newName } = req.body;

    if (!newName || typeof newName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "newName"' });
    }

    try {
        renameTable(dbId, tableName, newName);
        res.json({ success: true, renamedTo: newName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to rename table', detail: String(err) });
    }
});


// Changes table visibility
router.patch('/:dbId/table/:tableName/visibility', (req, res) => {
    const { dbId, tableName } = req.params;
    const { hidden } = req.body;

    if (typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'Missing or invalid "hidden" boolean value' });
    }

    try {
        setTableVisibility(dbId, tableName, hidden);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update table visibility', detail: String(err) });
    }
});


// Deletes a table from the database
router.delete('/:dbId/table/:tableName', (req, res) => {
    const { dbId, tableName } = req.params;

    try {
        deleteTable(dbId, tableName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete table', detail: String(err) });
    }
});


export default router;
