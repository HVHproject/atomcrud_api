import express from 'express';
import { createDatabase, getDatabaseContents } from '../db/manager';

const router = express.Router();

// Create new database
router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid database name' });
    }

    try {
        const { id } = createDatabase(name);
        res.status(201).json({ message: 'Database created', id });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create database', detail: String(err) });
    }
});

// Get contents of database
router.get('/:dbId', (req, res) => {
    const { dbId } = req.params;

    try {
        const data = getDatabaseContents(dbId);
        res.json(data);
    } catch (err) {
        res.status(404).json({ error: 'Database not found', detail: String(err) });
    }
});

export default router;
