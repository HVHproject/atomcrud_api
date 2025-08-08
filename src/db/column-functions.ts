import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, ColumnType } from '../types';
import { columnTypeMap } from '../utils/type-mapping';

const DB_FOLDER = path.resolve('./databases');

function normalizeColumnName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '_');
}

const untouchable = ['id', 'title', 'content', 'date_created', 'date_modified', 'hidden'];

export function createColumn(
    dbId: string,
    tableName: string,
    rawName: string,
    customType: string,
    hidden = false
): ColumnDef {
    const columnName = normalizeColumnName(rawName);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath))
        throw new Error(`Database or metadata file not found for '${dbId}'`);

    const db = new Database(dbPath);
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    metadata.tables ??= {};
    metadata.tables[tableName] ??= { hidden: false, columns: {} };
    const columns = metadata.tables[tableName].columns ??= {};

    if (Object.keys(columns).includes(columnName)) {
        throw new Error(`Column '${columnName}' already exists in table '${tableName}'`);
    }

    const realSqlType = columnTypeMap[customType];
    if (!realSqlType) throw new Error(`Unknown column type '${customType}'`);

    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${realSqlType}`).run();

    columns[columnName] = { type: customType as ColumnType, hidden };
    metadata.modifiedAt = new Date().toISOString();

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return { name: columnName, type: customType as ColumnType, hidden };
}

export function getAllColumns(dbId: string, tableName: string): ColumnDef[] {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta || !tableMeta.columns) throw new Error(`Table '${tableName}' or its columns not found in metadata.`);

    return Object.entries(tableMeta.columns).map(([name, colDef]): ColumnDef => ({
        name,
        type: colDef.type as ColumnType,
        hidden: colDef.hidden ?? false,
    }));
}

export function getSingleColumn(dbId: string, tableName: string, columnName: string): ColumnDef {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    const colDef = tableMeta?.columns?.[columnName];
    if (!colDef) throw new Error(`Column '${columnName}' not found in table '${tableName}'`);

    return {
        name: columnName,
        type: colDef.type as ColumnType,
        hidden: colDef.hidden ?? false,
    };
}

export function deleteColumn(dbId: string, tableName: string, rawName: string): void {
    const columnName = normalizeColumnName(rawName);

    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be deleted.`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);

    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath))
        throw new Error(`Database or metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const db = new Database(dbPath);
    try {
        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`).run();
    } catch (err) {
        throw new Error(`Failed to drop column '${columnName}': ${(err as Error).message}`);
    }

    delete columns[columnName];
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}
