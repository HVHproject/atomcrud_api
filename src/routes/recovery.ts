import express from 'express';
import {
    backupDatabase,
    listBackups,
    recoverBackup,
    deleteBackup,
} from '../db/recovery-functions';

const router = express.Router();

// Create a backup
router.post('/backup/:dbId', (req, res) => {
    const { dbId } = req.params;
    const result = backupDatabase(dbId);
    if (result.success) {
        res.status(201).json(result);
    } else {
        res.status(400).json(result);
    }
});

// List all backups
router.get('/backups/retrieve', (req, res) => {
    const result = listBackups();
    if (result.success) {
        res.json(result);
    } else {
        res.status(404).json(result);
    }
});

// Recover a specific backup
router.post('/recover/:backupName', (req, res) => {
    const { backupName } = req.params;
    const result = recoverBackup(backupName);
    if (result.success) {
        res.status(201).json(result);
    } else {
        res.status(400).json(result);
    }
});

// Delete a backup
router.delete('/backup/:backupName', (req, res) => {
    const { backupName } = req.params;
    const result = deleteBackup(backupName);
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(404).json(result);
    }
});

export default router;
