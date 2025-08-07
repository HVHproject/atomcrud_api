import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DatabaseMetadata } from '../types/types';

const DB_FOLDER = path.resolve('./databases');

if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER);
}

// Ensures clean database names
function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 30); // limit length
}

// Creates a database with a standard format
export function createDatabase(displayName: string): { id: string; filePath: string } {
    const safeName = sanitizeName(displayName);
    const timestamp = Date.now();
    const id = `${safeName}_${timestamp}`;
    const filePath = path.join(DB_FOLDER, `${id}.sqlite`);

    const db = new Database(filePath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            date_created INTEGER,
            date_updated INTEGER,
            hidden BOOLEAN DEFAULT 0
        );
    `);
    db.close();

    const metadata: DatabaseMetadata = {
        id,
        displayName,
        createdAt: new Date(timestamp).toISOString(),
        modifiedAt: new Date(timestamp).toISOString(),
        description: "",
        tags: [],
        hidden: false,
        tables: {
            entries: {
                hidden: false,
                columns: {
                    id: { type: "integer" },
                    title: { type: "string" },
                    content: { type: "rich_text" },
                    date_created: { type: "date" },
                    date_updated: { type: "date" },
                    hidden: { type: "boolean", hidden: true },
                },
            },
        },
    };

    const metaPath = path.join(DB_FOLDER, `${id}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return { id, filePath };
}

// Lists all databases
export function listDatabases({ includeRows = false }: { includeRows?: boolean } = {}) {
    const files = fs.readdirSync(DB_FOLDER);

    const dbEntries = files
        .filter(file => file.endsWith('.sqlite'))
        .map(file => {
            const id = path.basename(file, '.sqlite');
            const fullPath = path.join(DB_FOLDER, file);
            const metadataPath = path.join(DB_FOLDER, `${id}.meta.json`);

            if (!fs.existsSync(metadataPath)) {
                throw new Error(`Missing metadata file for database '${id}'`);
            }

            const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

            const db = new Database(fullPath);
            const tableNamesStmt = db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
            );
            const tableNames = (tableNamesStmt.all() as { name: string }[]).map(row => row.name);

            const tables = tableNames.map((tableName: string) => {
                const hiddenMeta = metadata.tables?.[tableName]?.hidden ?? false;

                const columnDefs = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col: any) => ({
                    name: col.name,
                    type: metadata.tables?.[tableName]?.columns?.[col.name]?.type ?? 'string',
                    hidden: metadata.tables?.[tableName]?.columns?.[col.name]?.hidden ?? false,
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

            return {
                id,
                metadata,
                tables,
            };
        });

    return dbEntries;
}

// Gets all tables from the database
export function getDatabaseTables(dbId: string) {
    const filePath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(filePath)) throw new Error(`Database '${dbId}' does not exist.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const db = new Database(filePath);

    const tableNamesStmt = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    const tableNames = (tableNamesStmt.all() as { name: string }[]).map(row => row.name);

    const tables = tableNames.map((tableName: string) => {
        const hiddenMeta = metadata.tables?.[tableName]?.hidden ?? false;

        const columnDefs = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col: any) => ({
            name: col.name,
            type: metadata.tables?.[tableName]?.columns?.[col.name]?.type ?? 'string',
            hidden: metadata.tables?.[tableName]?.columns?.[col.name]?.hidden ?? false,
        }));

        return {
            name: tableName,
            hidden: hiddenMeta,
            columns: columnDefs,
        };
    });

    db.close();

    return {
        id: dbId,
        metadata,
        tables,
    };
}


// Renames the database and its metadata file
export function renameDatabase(oldId: string, newDisplayName: string): {
    oldId: string;
    newId: string;
    filePath: string;
} {
    const oldDataPath = path.join(DB_FOLDER, `${oldId}.sqlite`);
    const oldMetaPath = path.join(DB_FOLDER, `${oldId}.meta.json`);

    if (!fs.existsSync(oldDataPath)) {
        throw new Error(`Database '${oldId}' does not exist.`);
    }

    const safeName = sanitizeName(newDisplayName);
    const timestamp = Date.now();
    const newId = `${safeName}_${timestamp}`;

    const newDataPath = path.join(DB_FOLDER, `${newId}.sqlite`);
    const newMetaPath = path.join(DB_FOLDER, `${newId}.meta.json`);

    // Rename database file
    fs.renameSync(oldDataPath, newDataPath);

    // Rename and update metadata file if it exists
    if (fs.existsSync(oldMetaPath)) {
        const metadataRaw = fs.readFileSync(oldMetaPath, 'utf-8');
        const metadata: DatabaseMetadata = JSON.parse(metadataRaw);

        // Update metadata fields
        metadata.id = newId;
        metadata.displayName = newDisplayName;
        metadata.modifiedAt = new Date(timestamp).toISOString();

        // Write updated metadata to new file
        fs.writeFileSync(newMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');

        // Delete old metadata file
        fs.unlinkSync(oldMetaPath);
    }

    return { oldId, newId, filePath: newDataPath };
}

// Deletes the database file and its metadata
export function deleteDatabase(dbId: string): { success: boolean; message: string } {
    const filePath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(filePath)) {
        return { success: false, message: `Database '${dbId}' does not exist.` };
    }

    try {
        fs.unlinkSync(filePath);

        if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
        }

        return { success: true, message: `Database '${dbId}' and its metadata were deleted.` };
    } catch (error: any) {
        return {
            success: false,
            message: `Failed to delete database '${dbId}': ${error.message}`,
        };
    }
}