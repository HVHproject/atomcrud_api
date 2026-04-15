import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DatabaseMetadata } from '../types/types';
import { columnTypeMap } from '../utils/type-mapping';
import { DB_FOLDER, getDbPaths } from '../utils/db-paths';

// Ensures clean database names
function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/, '')
        .slice(0, 30);
}

/**
 * Creates a new database.
 *
 * Produces the following folder structure:
 *   databases/
 *     {safeName}_{timestamp}/
 *       {safeName}.sqlite
 *       {safeName}.meta.json
 *       Gallery/
 */
export function createDatabase(displayName: string): { id: string; filePath: string } {
    const safeName = sanitizeName(displayName);
    const timestamp = Date.now();
    const id = `${safeName}_${timestamp}`;

    const { folderPath, dbPath, metaPath, galleryPath } = getDbPaths(id);

    fs.mkdirSync(folderPath, { recursive: true });
    fs.mkdirSync(galleryPath, { recursive: true });

    const db = new Database(dbPath);
    db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
        id ${columnTypeMap["integer"]} PRIMARY KEY AUTOINCREMENT,
        title ${columnTypeMap["string"]},
        content ${columnTypeMap["rich_text"]},
        date_created ${columnTypeMap["date"]},
        date_modified ${columnTypeMap["date"]},
        hidden ${columnTypeMap["boolean"]} DEFAULT 0
    );
`);
    db.close();

    const metadata: DatabaseMetadata = {
        id,
        displayName,
        createdAt: new Date(timestamp).toISOString(),
        modifiedAt: new Date(timestamp).toISOString(),
        description: "",
        hidden: false,
        globalTagLists: {},
        tables: {
            entries: {
                hidden: false,
                columns: {
                    id:            { type: "integer",   index: 0, visualization: '' },
                    title:         { type: "string",    index: 1, visualization: '' },
                    content:       { type: "rich_text", index: 2, visualization: '' },
                    date_created:  { type: "date",      index: 3, visualization: '' },
                    date_modified: { type: "date",      index: 4, visualization: '' },
                    hidden:        { type: "boolean",   index: 5, visualization: '', hidden: true },
                },
            },
        },
    };

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return { id, filePath: dbPath };
}

// Lists all databases
export function listDatabases({ includeRows = false }: { includeRows?: boolean } = {}) {
    const entries = fs.readdirSync(DB_FOLDER, { withFileTypes: true });

    const dbEntries = entries
        .filter(e => e.isDirectory())
        .map(e => {
            const id = e.name;
            const { dbPath, metaPath } = getDbPaths(id);

            if (!fs.existsSync(dbPath)) return null;
            if (!fs.existsSync(metaPath)) {
                throw new Error(`Missing metadata file for database '${id}'`);
            }

            const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const db = new Database(dbPath);

            const tableNames = (
                db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]
            ).map(row => row.name);

            const tables = tableNames.map((tableName: string) => {
                const hiddenMeta = metadata.tables?.[tableName]?.hidden ?? false;
                const columnDefs = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col: any) => ({
                    name: col.name,
                    type: metadata.tables?.[tableName]?.columns?.[col.name]?.type ?? 'string',
                    hidden: metadata.tables?.[tableName]?.columns?.[col.name]?.hidden ?? false,
                    index: metadata.tables?.[tableName]?.columns?.[col.name]?.index ?? -1,
                }));
                const rows = includeRows
                    ? db.prepare(`SELECT * FROM ${tableName}`).all()
                    : undefined;
                return {
                    name: tableName,
                    hidden: hiddenMeta,
                    columns: columnDefs,
                    ...(includeRows && { rows })
                };
            });

            db.close();
            return { id, metadata, tables };
        })
        .filter(Boolean);

    return dbEntries;
}

// Gets all tables from the database (no row data)
export function getDatabaseTables(dbId: string) {
    const { dbPath, metaPath } = getDbPaths(dbId);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' does not exist.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const db = new Database(dbPath);

    const tableNames = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]
    ).map(row => row.name);

    const tables = tableNames.map((tableName: string) => {
        const hiddenMeta = metadata.tables?.[tableName]?.hidden ?? false;
        const columnDefs = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col: any) => ({
            name: col.name,
            type: metadata.tables?.[tableName]?.columns?.[col.name]?.type ?? 'string',
            hidden: metadata.tables?.[tableName]?.columns?.[col.name]?.hidden ?? false,
            index: metadata.tables?.[tableName]?.columns?.[col.name]?.index ?? -1,
        }));
        return { name: tableName, hidden: hiddenMeta, columns: columnDefs };
    });

    db.close();
    return { id: dbId, metadata, tables };
}

/**
 * Renames a database. Creates a new folder with the new name/timestamp,
 * copies all files (including Gallery), then removes the old folder.
 */
export function renameDatabase(oldId: string, newDisplayName: string): {
    oldId: string;
    newId: string;
} {
    const { folderPath: oldFolderPath, dbPath: oldDbPath, metaPath: oldMetaPath, galleryPath: oldGalleryPath } = getDbPaths(oldId);

    if (!fs.existsSync(oldFolderPath)) {
        throw new Error(`Database '${oldId}' does not exist.`);
    }

    const safeName = sanitizeName(newDisplayName);
    const timestamp = Date.now();
    const newId = `${safeName}_${timestamp}`;

    const { folderPath: newFolderPath, dbPath: newDbPath, metaPath: newMetaPath, galleryPath: newGalleryPath } = getDbPaths(newId);

    fs.mkdirSync(newFolderPath, { recursive: true });
    fs.mkdirSync(newGalleryPath, { recursive: true });

    // Copy database file
    fs.copyFileSync(oldDbPath, newDbPath);

    // Update and copy metadata
    if (fs.existsSync(oldMetaPath)) {
        const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(oldMetaPath, 'utf-8'));
        metadata.id = newId;
        metadata.displayName = newDisplayName;
        metadata.modifiedAt = new Date(timestamp).toISOString();
        fs.writeFileSync(newMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }

    // Copy Gallery contents if any
    if (fs.existsSync(oldGalleryPath)) {
        fs.cpSync(oldGalleryPath, newGalleryPath, { recursive: true });
    }

    // Remove old folder
    fs.rmSync(oldFolderPath, { recursive: true, force: true });

    return { oldId, newId };
}

// Sets the hidden flag on a database's metadata
export function setDatabaseHidden(dbId: string, hidden: boolean): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    metadata.hidden = hidden;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

// Deletes the database folder and all its contents
export function deleteDatabase(dbId: string): { success: boolean; message: string } {
    const { folderPath } = getDbPaths(dbId);

    if (!fs.existsSync(folderPath)) {
        return { success: false, message: `Database '${dbId}' does not exist.` };
    }

    try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        return { success: true, message: `Database '${dbId}' and all its files were deleted.` };
    } catch (error: any) {
        return {
            success: false,
            message: `Failed to delete database '${dbId}': ${error.message}`,
        };
    }
}
