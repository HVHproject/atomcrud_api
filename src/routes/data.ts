import express from 'express';
import { createDatabase, deleteDatabase, getDatabaseContents, listDatabases } from '../db/manager';

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

router.get('/', (req, res) => {
    try {
        const databases = listDatabases();
        res.json(databases);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list databases', detail: String(err) });
    }
});

router.delete('/:dbId', (req, res) => {
    const { dbId } = req.params;
    const result = deleteDatabase(dbId);
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(404).json(result);
    }
});


export default router;
