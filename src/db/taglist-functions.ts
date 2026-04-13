/**
 * GlobalTagList functions.
 *
 * A GlobalTagList is a database-level, named list of strings stored in the
 * database metadata. It can be sourced from:
 *   - single_tag / multi_tag columns  → copies the registered tag names
 *   - string columns                  → scans all rows for unique non-null values
 *
 * Linking a GlobalTagList to a tag column:
 *   1. Replaces the column's tags[] with the list's values[]
 *   2. Sets tagLock = true (prevents manual tag edits)
 *   3. Stores the listId in column.linkedList
 *
 * Unlinking:
 *   1. Clears column.linkedList
 *   2. Sets tagLock = false
 *   3. Tags remain as-is until the user manually edits them
 */

import fs from 'fs';
import Database from 'better-sqlite3';
import type { DatabaseMetadata, GlobalTagList, TagDef } from '../types';
import { getDbPaths } from '../utils/db-paths';
import { normalizeName } from '../utils/normalize-name';

type SyncableType = 'string' | 'single_tag' | 'multi_tag';
const SYNCABLE_TYPES: SyncableType[] = ['string', 'single_tag', 'multi_tag'];

// ─────────────────────────────────────────────────────────────────────────────
// Sync a column into a GlobalTagList
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Syncs the contents of a column into a GlobalTagList entry in the database
 * metadata. If a list already exists for that table+column pair, it is updated
 * in-place; otherwise a new list is created.
 *
 * Returns the full GlobalTagList entry after syncing.
 *
 * For single_tag / multi_tag  → values = column's registered tag names
 * For string                  → values = every unique non-null string in the column
 */
export function syncToGlobalTagList(
    dbId: string,
    tableName: string,
    columnName: string,
    listName?: string
): GlobalTagList {
    const { dbPath, metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const colMeta = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!colMeta) throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);

    const sourceType = colMeta.type as string;
    if (!SYNCABLE_TYPES.includes(sourceType as SyncableType)) {
        throw new Error(
            `Column '${columnName}' has type '${sourceType}'. ` +
            `Only string, single_tag, and multi_tag columns can be synced to a GlobalTagList.`
        );
    }

    // Find existing list for this table+column (if any)
    metadata.globalTagLists ??= {};
    const existing = Object.values(metadata.globalTagLists).find(
        l => l.sourceTable === tableName && l.sourceColumn === columnName
    );

    const id = existing?.id ?? `${normalizeName(tableName)}_${normalizeName(columnName)}_${Date.now()}`;
    const now = new Date().toISOString();

    let values: string[];

    if (sourceType === 'single_tag' || sourceType === 'multi_tag') {
        // Extract tag names from metadata
        values = (colMeta.tags ?? []).map((t: TagDef) => t.name);
    } else {
        // string — scan rows for unique values
        const db = new Database(dbPath);
        try {
            const rows = db
                .prepare(`SELECT DISTINCT "${columnName}" FROM "${tableName}" WHERE "${columnName}" IS NOT NULL AND "${columnName}" != ''`)
                .all() as Record<string, any>[];
            values = rows.map(r => String(r[columnName])).filter(Boolean);
        } finally {
            db.close();
        }
    }

    const list: GlobalTagList = {
        id,
        name: listName ?? (existing?.name ?? `${tableName}.${columnName}`),
        sourceTable: tableName,
        sourceColumn: columnName,
        sourceType: sourceType as SyncableType,
        values,
        lastSyncedAt: now,
    };

    metadata.globalTagLists[id] = list;
    metadata.modifiedAt = now;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    // If any tag column is linked to this list, also update its tags[] automatically
    _propagateListToLinkedColumns(metadata, id);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// List GlobalTagLists
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all GlobalTagLists for this database. */
export function listGlobalTagLists(dbId: string): GlobalTagList[] {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return Object.values(metadata.globalTagLists ?? {});
}

/** Returns a single GlobalTagList by id. */
export function getGlobalTagList(dbId: string, listId: string): GlobalTagList {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const list = metadata.globalTagLists?.[listId];
    if (!list) throw new Error(`GlobalTagList '${listId}' not found.`);
    return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete a GlobalTagList
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deletes a GlobalTagList. Any columns currently linked to this list are
 * automatically unlinked first (tagLock reset to false, linkedList cleared),
 * so they keep whatever tags they had but become editable again.
 */
export function deleteGlobalTagList(dbId: string, listId: string): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!metadata.globalTagLists?.[listId]) {
        throw new Error(`GlobalTagList '${listId}' not found.`);
    }

    // Unlink any columns that reference this list
    _unlinkListFromAllColumns(metadata, listId);

    delete metadata.globalTagLists[listId];
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Link a tag column to a GlobalTagList
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Links a single_tag or multi_tag column to a GlobalTagList.
 *
 * Effects:
 *   - column.linkedList = listId
 *   - column.tagLock    = true
 *   - column.tags[]     = list.values[] (converted to TagDef[])
 */
export function linkColumnToTagList(
    dbId: string,
    tableName: string,
    columnName: string,
    listId: string
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const list = metadata.globalTagLists?.[listId];
    if (!list) throw new Error(`GlobalTagList '${listId}' not found.`);

    const col = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!col) throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);
    if (col.type !== 'single_tag' && col.type !== 'multi_tag') {
        throw new Error(`Only single_tag / multi_tag columns can be linked to a GlobalTagList.`);
    }

    col.linkedList = listId;
    col.tagLock = true;
    col.tags = list.values.map(v => ({ name: v, description: '' }));

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Unlink a tag column from its GlobalTagList
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unlinks a tag column from its GlobalTagList.
 *
 * Effects:
 *   - column.linkedList = ''
 *   - column.tagLock    = false
 *   - column.tags[]     unchanged (retains the last-synced values)
 */
export function unlinkColumnFromTagList(
    dbId: string,
    tableName: string,
    columnName: string
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const col = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!col) throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);

    col.linkedList = '';
    col.tagLock = false;

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After a list is synced, update tags[] on every column currently linked to it.
 * Mutates metadata in-place — caller is responsible for writing to disk.
 */
function _propagateListToLinkedColumns(metadata: DatabaseMetadata, listId: string): void {
    const list = metadata.globalTagLists?.[listId];
    if (!list) return;

    const newTags: TagDef[] = list.values.map(v => ({ name: v, description: '' }));

    for (const tableMeta of Object.values(metadata.tables ?? {})) {
        for (const col of Object.values(tableMeta.columns ?? {})) {
            if (col.linkedList === listId) {
                col.tags = newTags;
            }
        }
    }
}

/**
 * Clear linkedList and tagLock on every column linked to the given listId.
 * Mutates metadata in-place — caller is responsible for writing to disk.
 */
function _unlinkListFromAllColumns(metadata: DatabaseMetadata, listId: string): void {
    for (const tableMeta of Object.values(metadata.tables ?? {})) {
        for (const col of Object.values(tableMeta.columns ?? {})) {
            if (col.linkedList === listId) {
                col.linkedList = '';
                col.tagLock = false;
            }
        }
    }
}
