import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, ColumnType, TagDef } from '../types';
import { columnTypeMap } from '../utils/type-mapping';
import { normalizeName } from '../utils/normalize-name';
import { getDbPaths } from '../utils/db-paths';

const untouchable = ['id', 'title', 'content', 'date_created', 'date_modified', 'hidden'];

// Creates a column
export function createColumn(
    dbId: string,
    tableName: string,
    rawName: string,
    customType: string,
    hidden = false,
    index?: number,
    visualization?: string
): ColumnDef {
    const columnName = normalizeName(rawName);
    const { dbPath, metaPath } = getDbPaths(dbId);

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
    db.close();

    const currentColumnCount = Object.keys(columns).length;
    const assignedIndex = typeof index === 'number' ? index : currentColumnCount;
    const isTagType = customType === 'multi_tag' || customType === 'single_tag';
    const isRefType = customType === 'table_ref' || customType === 'table_ref_many';

    columns[columnName] = {
        type: customType as ColumnType,
        hidden,
        index: assignedIndex,
        visualization: visualization ?? '',
        required: 'no',
        ...(isTagType ? { tags: [] as TagDef[], tagLock: false } : {}),
        ...(customType === 'custom' ? { rule: '' } : {}),
        ...(isRefType ? { linkedTable: '' } : {}),
    };

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return {
        name: columnName,
        type: customType as ColumnType,
        hidden,
        index: assignedIndex,
        visualization: visualization ?? '',
        required: 'no' as const,
        ...(isTagType ? { tags: [], tagLock: false } : {}),
        ...(isRefType ? { linkedTable: '' } : {}),
    };
}

// Gets all columns from a table
export function getAllColumns(dbId: string, tableName: string): ColumnDef[] {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta || !tableMeta.columns) throw new Error(`Table '${tableName}' or its columns not found in metadata.`);

    return Object.entries(tableMeta.columns).map(([name, colDef]): ColumnDef => {
        const baseDef: ColumnDef = {
            name,
            type: colDef.type as ColumnType,
            hidden: colDef.hidden ?? false,
            index: typeof colDef.index === 'number' ? colDef.index : -1,
            visualization: colDef.visualization ?? '',
            required: colDef.required ?? 'no',
        };
        if (colDef.type === 'single_tag' || colDef.type === 'multi_tag') {
            baseDef.tags = Array.isArray(colDef.tags) ? colDef.tags : [];
            baseDef.tagLock = colDef.tagLock ?? false;
        }
        if (colDef.rule !== undefined) {
            baseDef.rule = colDef.rule;
        }
        if (colDef.type === 'table_ref' || colDef.type === 'table_ref_many') {
            baseDef.linkedTable = colDef.linkedTable ?? '';
        }
        return baseDef;
    });
}

// Gets a single column from a table
export function getSingleColumn(dbId: string, tableName: string, columnName: string): ColumnDef {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    const colDef = tableMeta?.columns?.[columnName];
    if (!colDef) throw new Error(`Column '${columnName}' not found in table '${tableName}'`);

    const result: ColumnDef = {
        name: columnName,
        type: colDef.type as ColumnType,
        hidden: colDef.hidden ?? false,
        index: typeof colDef.index === 'number' ? colDef.index : -1,
        visualization: colDef.visualization ?? '',
        required: colDef.required ?? 'no',
    };
    if (colDef.type === 'single_tag' || colDef.type === 'multi_tag') {
        result.tags = Array.isArray(colDef.tags) ? colDef.tags : [];
        result.tagLock = colDef.tagLock ?? false;
    }
    if (colDef.rule !== undefined) {
        result.rule = colDef.rule;
    }
    if (colDef.type === 'table_ref' || colDef.type === 'table_ref_many') {
        result.linkedTable = colDef.linkedTable ?? '';
    }
    return result;
}

// Updates name, or drops + re-adds a column with a new type
export function updateColumnNameOrType(
    dbId: string,
    tableName: string,
    rawOldName: string,
    newName?: string,
    newType?: string
): ColumnDef {
    const oldName = normalizeName(rawOldName);

    if (untouchable.includes(oldName))
        throw new Error(`Column '${oldName}' is protected and cannot be modified.`);

    const { dbPath, metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath))
        throw new Error(`Database or metadata file not found for '${dbId}'`);

    const db = new Database(dbPath);
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[oldName])
        throw new Error(`Column '${oldName}' not found in metadata.`);

    const currentDef = columns[oldName];
    const finalName = newName ? normalizeName(newName) : oldName;

    if (newName && finalName !== oldName) {
        db.prepare(`ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${finalName}`).run();
        columns[finalName] = { ...currentDef };
        delete columns[oldName];
    }

    if (newType && newType !== currentDef.type) {
        const realSqlType = columnTypeMap[newType];
        if (!realSqlType) throw new Error(`Unknown column type '${newType}'`);

        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${finalName}`).run();
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${finalName} ${realSqlType}`).run();

        const isTagType = newType === 'multi_tag' || newType === 'single_tag';
        const isRefType = newType === 'table_ref' || newType === 'table_ref_many';
        columns[finalName] = {
            type: newType as ColumnType,
            hidden: currentDef.hidden ?? false,
            index: currentDef.index ?? -1,
            visualization: currentDef.visualization ?? '',
            required: currentDef.required ?? 'no',
            ...(isTagType ? { tags: [] as TagDef[], tagLock: false } : {}),
            ...(newType === 'custom' ? { rule: currentDef.rule ?? '' } : {}),
            ...(isRefType ? { linkedTable: '' } : {}),
        };
    }

    db.close();
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return {
        name: finalName,
        type: columns[finalName].type,
        hidden: columns[finalName].hidden ?? false,
        index: typeof columns[finalName].index === 'number' ? columns[finalName].index : -1,
        visualization: columns[finalName].visualization ?? '',
    };
}

// Changes column visibility
export function updateColumnVisibility(
    dbId: string,
    tableName: string,
    rawName: string,
    hidden: boolean
): ColumnDef {
    const columnName = normalizeName(rawName);
    const { metaPath } = getDbPaths(dbId);
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
        index: typeof columns[columnName].index === 'number' ? columns[columnName].index : -1,
        visualization: columns[columnName].visualization ?? '',
    };
}

/**
 * Sets the visualization hint on a column. This is a free-form string that
 * the front end can use to decide how to render the column (e.g. "progress",
 * "stars", "color", "pill", "avatar").
 */
export function updateColumnVisualization(
    dbId: string,
    tableName: string,
    rawName: string,
    visualization: string
): ColumnDef {
    const columnName = normalizeName(rawName);
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    columns[columnName].visualization = visualization;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return getSingleColumn(dbId, tableName, columnName);
}

/**
 * Sets tagLock on a single_tag or multi_tag column.
 */
export function updateTagLock(
    dbId: string,
    tableName: string,
    columnName: string,
    locked: boolean
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const col = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!col) throw new Error(`Column '${columnName}' not found.`);
    if (col.type !== 'single_tag' && col.type !== 'multi_tag')
        throw new Error(`tagLock only applies to single_tag / multi_tag columns.`);

    col.tagLock = locked;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Swap index of two columns in table metadata
export function swapColumnIndex(dbId: string, tableName: string, colName: string, targetIndex: number): void {
    const columnName = normalizeName(colName);
    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be reordered.`);

    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const sourceIndex = columns[columnName].index;
    if (typeof sourceIndex !== 'number' || sourceIndex < 0)
        throw new Error(`Invalid index for column '${columnName}'`);

    const targetEntry = Object.entries(columns).find(([, colDef]) => colDef.index === targetIndex);
    if (!targetEntry)
        throw new Error(`No column found with order ${targetIndex}`);

    const [targetColumnName] = targetEntry;
    if (untouchable.includes(targetColumnName))
        throw new Error(`Column '${targetColumnName}' is protected and cannot be swapped.`);

    columns[columnName].index = targetIndex;
    columns[targetColumnName].index = sourceIndex;

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Move a column to a new index, shifting others
export function moveColumnIndex(dbId: string, tableName: string, colName: string, newIndex: number): void {
    const columnName = normalizeName(colName);
    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be reordered.`);

    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const oldIndex = columns[columnName].index;
    if (typeof oldIndex !== 'number' || oldIndex < 0)
        throw new Error(`Invalid index for column '${columnName}'`);

    if (oldIndex === newIndex) return;

    // Reject if any untouchable column falls within the shift range
    const wouldDisplace = Object.entries(columns).some(([name, colDef]) => {
        if (!untouchable.includes(name)) return false;
        const idx = colDef.index;
        if (typeof idx !== 'number') return false;
        return oldIndex < newIndex
            ? idx > oldIndex && idx <= newIndex
            : idx >= newIndex && idx < oldIndex;
    });
    if (wouldDisplace)
        throw new Error(`Cannot move to index ${newIndex}: the range crosses a protected column.`);

    for (const [, colDef] of Object.entries(columns)) {
        if (typeof colDef.index !== 'number' || colDef.index < 0) continue;
        if (oldIndex < newIndex) {
            if (colDef.index > oldIndex && colDef.index <= newIndex) colDef.index--;
        } else {
            if (colDef.index >= newIndex && colDef.index < oldIndex) colDef.index++;
        }
    }

    columns[columnName].index = newIndex;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Adds a tag to a column's possible tag list
export function registerTag(
    dbId: string,
    tableName: string,
    columnName: string,
    tagName: string,
    description: string = ''
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const column = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found`);
    if (column.type !== 'single_tag' && column.type !== 'multi_tag')
        throw new Error(`Column '${columnName}' is not of type single_tag / multi_tag`);
    if (column.tagLock)
        throw new Error(`Column '${columnName}' has tagLock enabled. Tags cannot be added.`);

    const normalizedName = normalizeName(tagName);
    column.tags ??= [];
    if (column.tags.some(t => t.name === normalizedName)) {
        throw new Error(`Tag '${normalizedName}' already exists in column '${columnName}'`);
    }

    column.tags.push({ name: normalizedName, description: description.trim() });
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Removes a tag from a column's possible tag list
export function unregisterTag(
    dbId: string,
    tableName: string,
    columnName: string,
    tagName: string
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const column = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found`);
    if (column.type !== 'single_tag' && column.type !== 'multi_tag')
        throw new Error(`Column '${columnName}' is not of type single_tag / multi_tag`);
    if (column.tagLock)
        throw new Error(`Column '${columnName}' has tagLock enabled. Tags cannot be removed.`);

    const normalizedName = normalizeName(tagName);
    column.tags = (column.tags ?? []).filter(t => t.name !== normalizedName);
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

export function updateColumnRule(
    dbId: string,
    tableName: string,
    columnName: string,
    rule: string
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta) throw new Error(`Table '${tableName}' not found in metadata.`);

    const column = tableMeta.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found in metadata.`);
    if (column.type !== 'custom') throw new Error(`Only custom columns can have regex rules.`);

    try { new RegExp(rule); } catch {
        throw new Error(`Invalid regex expression: '${rule}'`);
    }

    column.rule = rule;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Sets the required level on a column
export function updateColumnRequired(
    dbId: string,
    tableName: string,
    rawName: string,
    required: 'yes' | 'soft yes' | 'no'
): ColumnDef {
    const columnName = normalizeName(rawName);
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    columns[columnName].required = required;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return getSingleColumn(dbId, tableName, columnName);
}

// Deletes an unprotected column
export function deleteColumn(dbId: string, tableName: string, rawName: string): void {
    const columnName = normalizeName(rawName);
    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be deleted.`);

    const { dbPath, metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath))
        throw new Error(`Database or metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const deletedIndex = typeof columns[columnName].index === 'number' ? columns[columnName].index : -1;

    const db = new Database(dbPath);
    try {
        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`).run();
    } catch (err) {
        throw new Error(`Failed to drop column '${columnName}': ${(err as Error).message}`);
    } finally {
        db.close();
    }

    delete columns[columnName];

    if (deletedIndex >= 0) {
        for (const [, colDef] of Object.entries(columns)) {
            if (typeof colDef.index === 'number' && colDef.index > deletedIndex) {
                colDef.index--;
            }
        }
    }

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}
