import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, Column, ColumnType } from '../types';

const DB_FOLDER = path.resolve('./databases');

if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER);
}

// Create new table attached to database
export function createTable(dbId: string, rawTableName: string): void {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    // Sanitize table name (you can improve this)
    const tableName = rawTableName.replace(/\W+/g, '_').toLowerCase();

    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            date_created INTEGER,
            date_updated INTEGER
        );
    `);
    db.close();

    // Update metadata
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // Ensure metadata.tables is initialized
    if (!metadata.tables) {
        metadata.tables = {};
    }

    metadata.tables[tableName] = {
        hidden: false,
        columns: {
            id: { type: "integer" },
            title: { type: "string" },
            content: { type: "rich_text" },
            date_created: { type: "date" },
            date_updated: { type: "date" },
        },
    };

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Gets specific table with rows
export function getTable(dbId: string, tableName: string) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const db = new Database(dbPath);

    // Check if the table exists
    const tableExistsStmt = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name = ?
    `);
    const found = tableExistsStmt.get(tableName);
    if (!found) throw new Error(`Table '${tableName}' does not exist in '${dbId}'`);

    // Read column types
    const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Column[];
    const columns: ColumnDef[] = columnInfo.map((col) => {
        const metaCol = metadata.tables?.[tableName]?.columns?.[col.name];
        return {
            name: col.name,
            type: typeof metaCol === 'object'
                ? metaCol.type
                : (typeof metaCol === 'string'
                    ? metaCol as ColumnType
                    : 'string'),
            hidden: typeof metaCol === 'object' ? metaCol.hidden ?? false : false,
        };
    });


    // Fetch rows
    const rows = db.prepare(`SELECT * FROM ${tableName}`).all();

    // Table-level hidden flag (default false)
    const hidden = metadata.tables?.[tableName]?.hidden ?? false;

    db.close();

    return {
        name: tableName,
        hidden,
        columns,
        rows,
    };
}

// Renames table
export function renameTable(dbId: string, oldName: string, newRawName: string): void {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const newName = newRawName.replace(/\W+/g, '_').toLowerCase();

    const db = new Database(dbPath);
    db.exec(`ALTER TABLE ${oldName} RENAME TO ${newName};`);
    db.close();

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (!metadata.tables?.[oldName]) {
        throw new Error(`Table '${oldName}' does not exist in metadata.`);
    }

    metadata.tables[newName] = metadata.tables[oldName];
    delete metadata.tables[oldName];
    metadata.modifiedAt = new Date().toISOString();

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}


// Hides/Unhides table
export function setTableVisibility(dbId: string, tableName: string, hidden: boolean): void {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (!metadata.tables?.[tableName]) {
        throw new Error(`Table '${tableName}' does not exist in metadata.`);
    }

    metadata.tables[tableName].hidden = hidden;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Deletes specific table
export function deleteTable(dbId: string, tableName: string): void {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const db = new Database(dbPath);
    db.exec(`DROP TABLE IF EXISTS ${tableName};`);
    db.close();

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (metadata.tables && metadata.tables[tableName]) {
        delete metadata.tables[tableName];
        metadata.modifiedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    }
}
