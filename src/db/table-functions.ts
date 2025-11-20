import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, Column, ColumnType } from '../types';
import { columnTypeMap } from '../utils/type-mapping';
import { parseSearchQuery, resolveFieldName } from '../utils/search';
import { normalizeName } from '../utils/normalize-name';

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

    const tableName = normalizeName(rawTableName);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!metadata.tables) metadata.tables = {};

    if (metadata.tables[tableName]) {
        throw new Error(`Table '${tableName}' already exists in '${dbId}'.`);
    }

    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE ${tableName} (
            id ${columnTypeMap["integer"]} PRIMARY KEY AUTOINCREMENT,
            title ${columnTypeMap["string"]},
            content ${columnTypeMap["rich_text"]},
            date_created ${columnTypeMap["date"]},
            date_modified ${columnTypeMap["date"]},
            hidden ${columnTypeMap["boolean"]} DEFAULT 0
        );
    `);
    db.close();

    metadata.tables[tableName] = {
        hidden: false,
        columns: {
            id: { type: "integer", index: 0 },
            title: { type: "string", index: 1 },
            content: { type: "rich_text", index: 2 },
            date_created: { type: "date", index: 3 },
            date_modified: { type: "date", index: 4 },
            hidden: { type: "boolean", hidden: true, index: 5 },
        },
    };

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Copies a table in a database
export function copyTable(
    sourceDbId: string,
    sourceTableName: string,
    targetDbId: string = sourceDbId,
    newRawTableName?: string
): void {
    const sourceDbPath = path.join(DB_FOLDER, `${sourceDbId}.sqlite`);
    const targetDbPath = path.join(DB_FOLDER, `${targetDbId}.sqlite`);
    const sourceMetaPath = path.join(DB_FOLDER, `${sourceDbId}.meta.json`);
    const targetMetaPath = path.join(DB_FOLDER, `${targetDbId}.meta.json`);

    if (!fs.existsSync(sourceDbPath)) throw new Error(`Source database '${sourceDbId}' not found.`);
    if (!fs.existsSync(targetDbPath)) throw new Error(`Target database '${targetDbId}' not found.`);
    if (!fs.existsSync(sourceMetaPath)) throw new Error(`Metadata for '${sourceDbId}' not found.`);
    if (!fs.existsSync(targetMetaPath)) throw new Error(`Metadata for '${targetDbId}' not found.`);

    const sourceMetadata: DatabaseMetadata = JSON.parse(fs.readFileSync(sourceMetaPath, 'utf-8'));
    const targetMetadata: DatabaseMetadata = JSON.parse(fs.readFileSync(targetMetaPath, 'utf-8'));

    const normalizedSourceTable = normalizeName(sourceTableName);
    const newTableName = normalizeName(newRawTableName || `${normalizedSourceTable}_copy_${Date.now()}`);

    if (!sourceMetadata.tables?.[normalizedSourceTable]) {
        throw new Error(`Source table '${normalizedSourceTable}' not found in metadata.`);
    }

    if (!targetMetadata.tables) {
        targetMetadata.tables = {};
    }

    if (targetMetadata.tables[newTableName]) {
        throw new Error(`Target table '${newTableName}' already exists in '${targetDbId}'.`);
    }

    // Determine if same database file
    const sameDb = sourceDbPath === targetDbPath;

    // Open database handles
    const db = new Database(sourceDbPath); // single handle if same file
    const sourceDb = sameDb ? db : new Database(sourceDbPath);
    const targetDb = sameDb ? db : new Database(targetDbPath);

    try {
        // Verify source table exists
        const exists = sourceDb
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
            .get(normalizedSourceTable);
        if (!exists) throw new Error(`Source table '${normalizedSourceTable}' does not exist in '${sourceDbId}'.`);

        // Get column info
        const columns = sourceDb
            .prepare(`PRAGMA table_info(${normalizedSourceTable})`)
            .all() as { name: string; type: string }[];

        const columnDefs = columns.map((c: { name: string; type: string }) => `${c.name} ${c.type}`).join(', ');
        targetDb.exec(`CREATE TABLE ${newTableName} (${columnDefs});`);

        const columnNames = columns.map((c: { name: string }) => c.name).join(', ');

        if (!sameDb) {
            // Cross-database copy
            targetDb.exec(`ATTACH DATABASE '${sourceDbPath}' AS sourceDb;`);
            targetDb.exec(`INSERT INTO ${newTableName} SELECT * FROM sourceDb.${normalizedSourceTable};`);
            targetDb.exec(`DETACH DATABASE sourceDb;`);
        } else {
            // Intra-database copy
            targetDb
                .prepare(
                    `INSERT INTO ${newTableName} (${columnNames}) SELECT ${columnNames} FROM ${normalizedSourceTable}`
                )
                .run();
        }

        // --- Update metadata ---
        const clonedTableMeta = JSON.parse(JSON.stringify(sourceMetadata.tables[normalizedSourceTable]));
        clonedTableMeta.hidden = false;
        targetMetadata.tables[newTableName] = clonedTableMeta;
        targetMetadata.modifiedAt = new Date().toISOString();

        fs.writeFileSync(targetMetaPath, JSON.stringify(targetMetadata, null, 2));
    } finally {
        // Close handles safely
        if (sameDb) {
            db.close();
        } else {
            sourceDb.close();
            targetDb.close();
        }
    }
}

// Gets specific table with rows
export function getTable(
    dbId: string,
    tableName: string,
    options?: {
        offset?: number;
        limit?: number;
        hidden?: boolean;
        search?: string;
        sort?: string;
    }
) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const db = new Database(dbPath);

    (db as any).function('REGEXP', (pattern: string, value: string) => {
        if (value === null) return 0;
        try {
            return new RegExp(pattern, 'i').test(value) ? 1 : 0;
        } catch {
            return 0;
        }
    });

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
            index: typeof metaCol === 'object' && typeof metaCol.index === 'number'
                ? metaCol.index
                : -1,
        };
    });

    let filters: string[] = [];
    let params: any[] = [];

    if (typeof options?.hidden === 'boolean') {
        filters.push(`hidden = ?`);
        params.push(options.hidden ? 1 : 0);
    }

    if (options?.search) {
        const { parseSearchQuery } = require('../utils/search');
        const searchResult = parseSearchQuery(options.search, columns);
        filters.push(searchResult.where);
        params.push(...searchResult.params);
    }

    let query = `SELECT * FROM ${tableName}`;
    if (filters.length) {
        query += ` WHERE ` + filters.join(' AND ');
    }

    // --- Sorting ---
    let sortCol = 'date_modified';
    let sortDir = 'DESC';

    if (options?.sort) {
    const [col, dir] = options.sort.split(':');

        if (col && col.toLowerCase() === 'rand') {
            query += ` ORDER BY RANDOM()`;
        } else {
            if (col) {
                const resolved = resolveFieldName(col, columns);
                if (resolved) sortCol = resolved;
            }

            if (dir && ['asc', 'desc'].includes(dir.toLowerCase())) {
                sortDir = dir.toUpperCase();
            }

            query += ` ORDER BY ${sortCol} ${sortDir}`;
        }
    } else {
        query += ` ORDER BY ${sortCol} ${sortDir}`;
    }

    // --- Pagination ---
    if (typeof options?.limit === 'number') {
        query += ` LIMIT ?`;
        params.push(options.limit);

        if (typeof options?.offset === 'number') {
            query += ` OFFSET ?`;
            params.push(options.offset);
        }
    }

    const rows = db.prepare(query).all(...params);

    const hidden = metadata.tables?.[tableName]?.hidden ?? false;

    type CountRow = { count: number };

    // Total rows (ignore filters/search)
    const totalRows = (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as CountRow).count;

    // Filtered rows (ignore pagination)
    const filteredRowsParams = [...params];

    // Remove any pagination params (last 1 or 2 items if limit/offset were added)
    if (typeof options?.limit === 'number') filteredRowsParams.pop();
    if (typeof options?.offset === 'number') filteredRowsParams.pop();

    let filteredRowsQuery = `SELECT COUNT(*) AS count FROM ${tableName}`;
    if (filters.length) filteredRowsQuery += ` WHERE ` + filters.join(' AND ');

    const filteredRows = (db.prepare(filteredRowsQuery).get(...filteredRowsParams) as CountRow).count;

    db.close();

    return {
        name: tableName,
        hidden,
        columns,
        rows,
        totalRows,
        filteredRows
    };
}

// Renames table
export function renameTable(dbId: string, oldName: string, newRawName: string): void {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const newName = normalizeName(newRawName);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (!metadata.tables?.[oldName]) {
        throw new Error(`Table '${oldName}' does not exist in metadata.`);
    }

    if (metadata.tables[newName]) {
        throw new Error(`Table '${newName}' already exists in '${dbId}'.`);
    }

    const db = new Database(dbPath);
    db.exec(`ALTER TABLE ${oldName} RENAME TO ${newName};`);
    db.close();

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
