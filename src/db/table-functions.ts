import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, Column, ColumnType } from '../types';
import { columnTypeMap } from '../utils/type-mapping';
import { parseSearchQuery, resolveFieldName, RefLookup } from '../utils/search';
import { normalizeName } from '../utils/normalize-name';
import { getDbPaths } from '../utils/db-paths';
import { cascadeOnTableDelete, cascadeOnTableRename } from './tableref-functions';

// Create new table attached to database
export function createTable(dbId: string, rawTableName: string): void {
    const { dbPath, metaPath } = getDbPaths(dbId);
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
            id:            { type: "integer",   index: 0, visualization: '' },
            title:         { type: "string",    index: 1, visualization: '' },
            content:       { type: "rich_text", index: 2, visualization: '' },
            date_created:  { type: "date",      index: 3, visualization: '' },
            date_modified: { type: "date",      index: 4, visualization: '' },
            hidden:        { type: "boolean",   index: 5, visualization: '', hidden: true },
        },
    };

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Copies a table — within the same database or to a different one
export function copyTable(
    sourceDbId: string,
    sourceTableName: string,
    targetDbId: string = sourceDbId,
    newRawTableName?: string
): void {
    const { dbPath: sourceDbPath, metaPath: sourceMetaPath } = getDbPaths(sourceDbId);
    const { dbPath: targetDbPath, metaPath: targetMetaPath } = getDbPaths(targetDbId);

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

    if (!targetMetadata.tables) targetMetadata.tables = {};

    if (targetMetadata.tables[newTableName]) {
        throw new Error(`Target table '${newTableName}' already exists in '${targetDbId}'.`);
    }

    const sameDb = sourceDbPath === targetDbPath;
    const db = new Database(sourceDbPath);
    const targetDb = sameDb ? db : new Database(targetDbPath);

    try {
        const exists = db
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
            .get(normalizedSourceTable);
        if (!exists) throw new Error(`Source table '${normalizedSourceTable}' does not exist in '${sourceDbId}'.`);

        const columns = db
            .prepare(`PRAGMA table_info(${normalizedSourceTable})`)
            .all() as { name: string; type: string }[];

        const columnDefs = columns.map(c => `${c.name} ${c.type}`).join(', ');
        targetDb.exec(`CREATE TABLE ${newTableName} (${columnDefs});`);

        const columnNames = columns.map(c => c.name).join(', ');

        if (!sameDb) {
            targetDb.exec(`ATTACH DATABASE '${sourceDbPath}' AS sourceDb;`);
            targetDb.exec(`INSERT INTO ${newTableName} SELECT * FROM sourceDb.${normalizedSourceTable};`);
            targetDb.exec(`DETACH DATABASE sourceDb;`);
        } else {
            db.prepare(
                `INSERT INTO ${newTableName} (${columnNames}) SELECT ${columnNames} FROM ${normalizedSourceTable}`
            ).run();
        }

        const clonedTableMeta = JSON.parse(JSON.stringify(sourceMetadata.tables[normalizedSourceTable]));
        clonedTableMeta.hidden = false;
        targetMetadata.tables[newTableName] = clonedTableMeta;
        targetMetadata.modifiedAt = new Date().toISOString();

        fs.writeFileSync(targetMetaPath, JSON.stringify(targetMetadata, null, 2));
    } finally {
        if (sameDb) {
            db.close();
        } else {
            db.close();
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
    const { dbPath, metaPath } = getDbPaths(dbId);

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

    const found = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName);
    if (!found) throw new Error(`Table '${tableName}' does not exist in '${dbId}'`);

    const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Column[];
    const columns: ColumnDef[] = columnInfo.map((col) => {
        const metaCol = metadata.tables?.[tableName]?.columns?.[col.name];
        const isObj = typeof metaCol === 'object' && metaCol !== null;
        const colType: ColumnType = isObj
            ? metaCol.type
            : (typeof metaCol === 'string' ? metaCol as ColumnType : 'string');
        const result: ColumnDef = {
            name: col.name,
            type: colType,
            hidden: isObj ? metaCol.hidden ?? false : false,
            index: isObj && typeof metaCol.index === 'number' ? metaCol.index : -1,
            visualization: isObj ? metaCol.visualization ?? '' : '',
            required: isObj ? metaCol.required ?? 'no' : 'no',
        };
        if (colType === 'single_tag' || colType === 'multi_tag') {
            result.tags = isObj && Array.isArray(metaCol.tags) ? metaCol.tags : [];
            result.tagLock = isObj ? metaCol.tagLock ?? false : false;
        }
        if (colType === 'custom' && isObj && metaCol.rule !== undefined) {
            result.rule = metaCol.rule;
        }
        if ((colType === 'table_ref' || colType === 'table_ref_many') && isObj) {
            result.linkedTable = metaCol.linkedTable ?? '';
        }
        return result;
    });

    let filters: string[] = [];
    let params: any[] = [];

    if (typeof options?.hidden === 'boolean') {
        filters.push(`hidden = ?`);
        params.push(options.hidden ? 1 : 0);
    }

    if (options?.search) {
        // Build display-value lookup for any table_ref/table_ref_many columns
        // that have a display column configured (stored in visualization).
        const refLookup: RefLookup = new Map();
        for (const col of columns) {
            if ((col.type === 'table_ref' || col.type === 'table_ref_many')
                && col.linkedTable && col.visualization) {
                try {
                    const rows = db.prepare(
                        `SELECT id, "${col.visualization}" AS display FROM "${col.linkedTable}"`
                    ).all() as Array<{ id: number; display: any }>;
                    refLookup.set(col.name, rows.map(r => ({
                        id: r.id,
                        display: r.display != null ? String(r.display) : '',
                    })));
                } catch {
                    // Linked table missing or display column gone — skip silently
                }
            }
        }
        const searchResult = parseSearchQuery(options.search, columns, refLookup);
        filters.push(searchResult.where);
        params.push(...searchResult.params);
    }

    let query = `SELECT * FROM ${tableName}`;
    if (filters.length) {
        query += ` WHERE ` + filters.join(' AND ');
    }

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

    const totalRows = (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as CountRow).count;

    const filteredRowsParams = [...params];
    if (typeof options?.limit === 'number') filteredRowsParams.pop();
    if (typeof options?.offset === 'number') filteredRowsParams.pop();

    let filteredRowsQuery = `SELECT COUNT(*) AS count FROM ${tableName}`;
    if (filters.length) filteredRowsQuery += ` WHERE ` + filters.join(' AND ');

    const filteredRows = (db.prepare(filteredRowsQuery).get(...filteredRowsParams) as CountRow).count;

    db.close();

    return { name: tableName, hidden, columns, rows, totalRows, filteredRows };
}

// Renames table
export function renameTable(dbId: string, oldName: string, newRawName: string): void {
    const { dbPath, metaPath } = getDbPaths(dbId);

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

    // Update linkedTable on any table_ref columns that pointed to the old name
    cascadeOnTableRename(dbId, oldName, newName);
}

// Hides/Unhides table
export function setTableVisibility(dbId: string, tableName: string, hidden: boolean): void {
    const { metaPath } = getDbPaths(dbId);
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
    const { dbPath, metaPath } = getDbPaths(dbId);

    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found.`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    // Null out & clear linkedTable on any table_ref columns pointing to this table
    // Must run before the table is dropped so the UPDATE statements still work
    cascadeOnTableDelete(dbId, tableName);

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
