import express from 'express';
import { createTable, deleteTable, getTable, renameTable, setTableVisibility } from '../db/table-functions';

const router = express.Router({ mergeParams: true }); // Important

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

// Get rows of a table in a specific database
// todo: add the following to the Postman when you have row data
// Get first 100 non-hidden rows: GET /api/mydb/table/entries?offset=0&limit=100&hidden=false
// Get second page of 100 visible rows: GET /api/mydb/table/entries?offset=100&limit=100&hidden=false
// Get all hidden rows: GET /api/mydb/table/entries?hidden=true
router.get('/:dbId/table/:tableName', (req, res) => {
    const { dbId, tableName } = req.params;
    const { offset, limit, hidden } = req.query;

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
