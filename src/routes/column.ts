import express from 'express';
import { createColumn, deleteColumn, getAllColumns, getSingleColumn } from '../db/column-functions';

const router = express.Router({ mergeParams: true });

// POST create a new column
router.post('/:dbId/table/:tableName/column', (req, res) => {
    const { dbId, tableName } = req.params;
    const { name, type, hidden } = req.body;

    if (!name || !type) {
        return res.status(400).json({ error: 'Missing name or type in request body' });
    }

    try {
        const newCol = createColumn(dbId, tableName, name, type, hidden ?? false);
        res.status(201).json(newCol);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create column', detail: String(err) });
    }
});


// GET all columns from a table
router.get('/:dbId/table/:tableName/columns', (req, res) => {
    const { dbId, tableName } = req.params;
    try {
        const columns = getAllColumns(dbId, tableName);
        res.json(columns);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get columns', detail: String(err) });
    }
});

// GET a specific column from a table
router.get('/:dbId/table/:tableName/column/:columnName', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    try {
        const column = getSingleColumn(dbId, tableName, columnName);
        res.json(column);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get column', detail: String(err) });
    }
});

// Deletes column
router.delete('/:dbId/table/:tableName/column/:columnName', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    try {
        deleteColumn(dbId, tableName, columnName);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

export default router;
