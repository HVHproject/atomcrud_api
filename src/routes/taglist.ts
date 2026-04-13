/**
 * GlobalTagList routes.
 *
 * All routes are mounted under /api/database.
 *
 * Database-level list management:
 *   GET    /api/database/:dbId/taglist                      – list all GlobalTagLists
 *   GET    /api/database/:dbId/taglist/:listId              – get a single list
 *   POST   /api/database/:dbId/taglist/sync                 – sync column → list (create or update)
 *   DELETE /api/database/:dbId/taglist/:listId              – delete a list (also unlinks columns)
 *
 * Column linking:
 *   POST   /api/database/:dbId/table/:tableName/column/:columnName/link    – link column to a list
 *   POST   /api/database/:dbId/table/:tableName/column/:columnName/unlink  – unlink column from its list
 *   PATCH  /api/database/:dbId/table/:tableName/column/:columnName/taglock – manually set tagLock
 *   PATCH  /api/database/:dbId/table/:tableName/column/:columnName/visualization – set visualization hint
 */

import express from 'express';
import {
    syncToGlobalTagList,
    listGlobalTagLists,
    getGlobalTagList,
    deleteGlobalTagList,
    linkColumnToTagList,
    unlinkColumnFromTagList,
} from '../db/taglist-functions';
import { updateTagLock, updateColumnVisualization } from '../db/column-functions';

const router = express.Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────────────────────
// GlobalTagList CRUD
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/database/:dbId/taglist — list all GlobalTagLists */
router.get('/:dbId/taglist', (req, res) => {
    const { dbId } = req.params;
    try {
        const lists = listGlobalTagLists(dbId);
        res.json({ lists });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list GlobalTagLists', detail: String(err) });
    }
});

/** GET /api/database/:dbId/taglist/:listId — get a single GlobalTagList */
router.get('/:dbId/taglist/:listId', (req, res) => {
    const { dbId, listId } = req.params;
    try {
        const list = getGlobalTagList(dbId, listId);
        res.json({ list });
    } catch (err) {
        res.status(404).json({ error: 'GlobalTagList not found', detail: String(err) });
    }
});

/**
 * POST /api/database/:dbId/taglist/sync
 *
 * Syncs a column into a GlobalTagList (create or update).
 *
 * Body:
 *   tableName   string  – required
 *   columnName  string  – required
 *   name        string  – optional display name for the list
 */
router.post('/:dbId/taglist/sync', (req, res) => {
    const { dbId } = req.params;
    const { tableName, columnName, name } = req.body;

    if (!tableName || typeof tableName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "tableName"' });
    }
    if (!columnName || typeof columnName !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "columnName"' });
    }

    try {
        const list = syncToGlobalTagList(dbId, tableName, columnName, name);
        res.json({ list });
    } catch (err) {
        res.status(500).json({ error: 'Failed to sync GlobalTagList', detail: String(err) });
    }
});

/** DELETE /api/database/:dbId/taglist/:listId — delete a GlobalTagList */
router.delete('/:dbId/taglist/:listId', (req, res) => {
    const { dbId, listId } = req.params;
    try {
        deleteGlobalTagList(dbId, listId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete GlobalTagList', detail: String(err) });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Column linking / visualization / tagLock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/database/:dbId/table/:tableName/column/:columnName/link
 *
 * Links a single_tag or multi_tag column to a GlobalTagList.
 * Automatically sets tagLock = true and replaces tags[] with list values.
 *
 * Body:
 *   listId  string  – required
 */
router.post('/:dbId/table/:tableName/column/:columnName/link', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { listId } = req.body;

    if (!listId || typeof listId !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "listId"' });
    }

    try {
        linkColumnToTagList(dbId, tableName, columnName, listId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to link column to GlobalTagList', detail: String(err) });
    }
});

/**
 * POST /api/database/:dbId/table/:tableName/column/:columnName/unlink
 *
 * Unlinks a column from its GlobalTagList.
 * Clears linkedList and resets tagLock to false. Tags remain unchanged.
 */
router.post('/:dbId/table/:tableName/column/:columnName/unlink', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    try {
        unlinkColumnFromTagList(dbId, tableName, columnName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to unlink column from GlobalTagList', detail: String(err) });
    }
});

/**
 * PATCH /api/database/:dbId/table/:tableName/column/:columnName/taglock
 *
 * Manually sets tagLock on a tag column.
 * Will throw if the column is currently linked to a GlobalTagList
 * (unlink first).
 *
 * Body:
 *   locked  boolean  – required
 */
router.patch('/:dbId/table/:tableName/column/:columnName/taglock', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { locked } = req.body;

    if (typeof locked !== 'boolean') {
        return res.status(400).json({ error: '"locked" must be a boolean' });
    }

    try {
        updateTagLock(dbId, tableName, columnName, locked);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update tagLock', detail: String(err) });
    }
});

/**
 * PATCH /api/database/:dbId/table/:tableName/column/:columnName/visualization
 *
 * Sets the visualization hint on any column.
 * This is a free-form string the front end uses to decide how to render the
 * column (e.g. "progress", "stars", "color", "pill", "avatar", "bar").
 *
 * Body:
 *   visualization  string  – required (empty string to clear)
 */
router.patch('/:dbId/table/:tableName/column/:columnName/visualization', (req, res) => {
    const { dbId, tableName, columnName } = req.params;
    const { visualization } = req.body;

    if (typeof visualization !== 'string') {
        return res.status(400).json({ error: '"visualization" must be a string' });
    }

    try {
        const updated = updateColumnVisualization(dbId, tableName, columnName, visualization);
        res.json({ column: updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update visualization', detail: String(err) });
    }
});

export default router;
