import express from 'express';
import { getSingleRow, createRow, deleteRow, patchRowVisibility } from '../db/row-functions';

const router = express.Router({ mergeParams: true });

// POST create a new row
router.post('/:dbId/table/:tableName/row', (req, res) => {
    const { dbId, tableName } = req.params;
    const { title, content, ...rest } = req.body;

    if (!title || !content) {
        return res.status(400).json({ error: 'Missing required title or content' });
    }

    try {
        const newRow = createRow(dbId, tableName, { title, content, ...rest });
        res.status(201).json(newRow);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create row', detail: String(err) });
    }
});

// GET a single row by ID
router.get('/:dbId/table/:tableName/row/:rowId', (req, res) => {
    const { dbId, tableName, rowId } = req.params;

    try {
        const row = getSingleRow(dbId, tableName, rowId);
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get row', detail: String(err) });
    }
});

// PATCH row visibility (toggle hidden flag)
router.patch('/:dbId/table/:tableName/row/:rowId/visibility', (req, res) => {
    const { dbId, tableName, rowId } = req.params;
    const { hidden } = req.body;

    if (typeof hidden !== 'number' && typeof hidden !== 'boolean') {
        return res.status(400).json({ error: '`hidden` field must be boolean or 0/1' });
    }

    const hiddenValue = hidden === true ? 1 : hidden === false ? 0 : hidden;

    try {
        const updatedRow = patchRowVisibility(dbId, tableName, rowId, hiddenValue);
        res.json(updatedRow);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update row visibility', detail: String(err) });
    }
});

// DELETE a row by ID
router.delete('/:dbId/table/:tableName/row/:rowId', (req, res) => {
    const { dbId, tableName, rowId } = req.params;

    try {
        deleteRow(dbId, tableName, rowId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete row', detail: String(err) });
    }
});

export default router;
