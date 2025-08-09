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

// Creates a column
export function createColumn(
    dbId: string,
    tableName: string,
    rawName: string,
    customType: string,
    hidden = false,
    order?: number
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

    // Determine order
    const currentColumnCount = Object.keys(columns).length;
    const assignedOrder = typeof order === 'number' ? order : currentColumnCount;

    columns[columnName] = { type: customType as ColumnType, hidden, order: assignedOrder };

    metadata.modifiedAt = new Date().toISOString();

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return { name: columnName, type: customType as ColumnType, hidden, order: assignedOrder };
}

// Gets all columns from a table
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
        order: typeof colDef.order === 'number' ? colDef.order : -1,
    }));
}

// Gets a column from a table
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
        order: typeof colDef.order === 'number' ? colDef.order : -1,
    };
}

// Updates name, or deletes old column and creates a new column with a name and type
export function updateColumnNameOrType(
    dbId: string,
    tableName: string,
    rawOldName: string,
    newName?: string,
    newType?: string
): ColumnDef {
    const oldName = normalizeColumnName(rawOldName);

    if (untouchable.includes(oldName))
        throw new Error(`Column '${oldName}' is protected and cannot be modified.`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);

    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath))
        throw new Error(`Database or metadata file not found for '${dbId}'`);

    const db = new Database(dbPath);
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[oldName])
        throw new Error(`Column '${oldName}' not found in metadata.`);

    const currentDef = columns[oldName];
    const finalName = newName ? normalizeColumnName(newName) : oldName;

    // 1) Rename if needed
    if (newName && finalName !== oldName) {
        db.prepare(`ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${finalName}`).run();

        columns[finalName] = { ...currentDef };
        delete columns[oldName];
    }

    // 2) Change type if needed — drop + re-add column (data loss warning)
    if (newType && newType !== currentDef.type) {
        const realSqlType = columnTypeMap[newType];
        if (!realSqlType) throw new Error(`Unknown column type '${newType}'`);

        const nameForTypeChange = finalName; // Might be renamed above

        // Drop old column
        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${nameForTypeChange}`).run();

        // Add new column with same name, new type
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${nameForTypeChange} ${realSqlType}`).run();

        columns[nameForTypeChange] = { type: newType as ColumnType, hidden: currentDef.hidden ?? false, order: currentDef.order ?? -1 };
    }

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return {
        name: finalName,
        type: columns[finalName].type,
        hidden: columns[finalName].hidden ?? false,
        order: typeof columns[finalName].order === 'number' ? columns[finalName].order : -1,
    };
}

// changes column visibility
export function updateColumnVisibility(
    dbId: string,
    tableName: string,
    rawName: string,
    hidden: boolean
): ColumnDef {
    const columnName = normalizeColumnName(rawName);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    columns[columnName].hidden = hidden;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return {
        name: columnName,
        type: columns[columnName].type,
        hidden,
        order: typeof columns[columnName].order === 'number' ? columns[columnName].order : -1,
    };
}

// Swap order of two columns in a table metadata
export function swapColumnOrder(dbId: string, tableName: string, colName: string, targetOrder: number): void {
    const columnName = normalizeColumnName(colName);

    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be reordered.`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const sourceOrder = columns[columnName].order;
    if (typeof sourceOrder !== 'number' || sourceOrder < 0)
        throw new Error(`Invalid order for column '${columnName}'`);

    // Find column with targetOrder
    const targetEntry = Object.entries(columns).find(([, colDef]) => colDef.order === targetOrder);
    if (!targetEntry)
        throw new Error(`No column found with order ${targetOrder}`);

    const [targetColumnName, targetColDef] = targetEntry;

    // Swap orders
    columns[columnName].order = targetOrder;
    columns[targetColumnName].order = sourceOrder;

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Move a column to a new order, shifting others
export function moveColumnOrder(dbId: string, tableName: string, colName: string, newOrder: number): void {
    const columnName = normalizeColumnName(colName);

    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be reordered.`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const oldOrder = columns[columnName].order;
    if (typeof oldOrder !== 'number' || oldOrder < 0)
        throw new Error(`Invalid order for column '${columnName}'`);

    if (oldOrder === newOrder) return; // no move needed

    // Shift other columns' orders accordingly
    for (const [, colDef] of Object.entries(columns)) {
        if (typeof colDef.order !== 'number' || colDef.order < 0) continue;

        if (oldOrder < newOrder) {
            // moving down — decrement orders between oldOrder+1 and newOrder
            if (colDef.order > oldOrder && colDef.order <= newOrder) {
                colDef.order--;
            }
        } else {
            // moving up — increment orders between newOrder and oldOrder-1
            if (colDef.order >= newOrder && colDef.order < oldOrder) {
                colDef.order++;
            }
        }
    }

    // Set the column's order to newOrder
    columns[columnName].order = newOrder;

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}


// Deletes unprotected column
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

    const deletedOrder = typeof columns[columnName].order === 'number' ? columns[columnName].order : -1;

    const db = new Database(dbPath);
    try {
        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`).run();
    } catch (err) {
        throw new Error(`Failed to drop column '${columnName}': ${(err as Error).message}`);
    }

    // Remove the deleted column metadata
    delete columns[columnName];

    // Shift orders down by 1 for columns with order > deletedOrder
    if (deletedOrder >= 0) {
        for (const [colName, colDef] of Object.entries(columns)) {
            if (typeof colDef.order === 'number' && colDef.order > deletedOrder) {
                colDef.order = colDef.order - 1;
            }
        }
    }

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}
