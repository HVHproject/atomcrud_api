import express from 'express';
import { createTable, getTable } from '../db/table-functions';

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
router.get('/:dbId/table/:tableName', (req, res) => {
    const { dbId, tableName } = req.params;

    try {
        const rows = getTable(dbId, tableName);
        res.json({ table: tableName, rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch table rows', detail: String(err) });
    }
});

export default router;
