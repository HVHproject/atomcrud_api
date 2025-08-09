import express from 'express';
import { createColumn, deleteColumn, getAllColumns, getSingleColumn, moveColumnOrder, swapColumnOrder, updateColumnNameOrType, updateColumnVisibility } from '../db/column-functions';

const router = express.Router({ mergeParams: true });

// POST create a new column
router.post('/:dbId/table/:tableName/column', (req, res) => {
    const { dbId, tableName } = req.params;
    const { name, type, hidden, order } = req.body;

    if (!name || !type) {
        return res.status(400).json({ error: 'Missing name or type in request body' });
    }

    try {
        const newCol = createColumn(dbId, tableName, name, type, hidden ?? false, order);
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

// PATCH rename or type change
router.patch('/:dbId/table/:tableName/column/:columnName', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { newName, newType } = req.body;

    if (!newName && !newType) {
        return res.status(400).json({ error: 'Must provide newName or newType in body' });
    }

    try {
        const updated = updateColumnNameOrType(dbId, tableName, columnName, newName, newType);
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

// PATCH change visibility
router.patch('/:dbId/table/:tableName/column/:columnName/visibility', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { hidden } = req.body;

    if (typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'hidden must be a boolean' });
    }

    try {
        const updated = updateColumnVisibility(dbId, tableName, columnName, hidden);
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

// PATCH swap order
router.patch('/:dbId/table/:tableName/column/:columnName/swap', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { targetOrder } = req.body;

    if (typeof targetOrder !== 'number') {
        return res.status(400).json({ error: 'targetOrder must be a number' });
    }

    try {
        swapColumnOrder(dbId, tableName, columnName, targetOrder);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
    }
});

// PATCH move order
router.patch('/:dbId/table/:tableName/column/:columnName/move', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { newOrder } = req.body;

    if (typeof newOrder !== 'number') {
        return res.status(400).json({ error: 'newOrder must be a number' });
    }

    try {
        moveColumnOrder(dbId, tableName, columnName, newOrder);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
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
