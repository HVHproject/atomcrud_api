import express from 'express';
import { getAllColumns, getSingleColumn } from '../db/column-functions';

const router = express.Router({ mergeParams: true });

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

export default router;
