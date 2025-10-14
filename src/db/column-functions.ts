import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnDef, DatabaseMetadata, ColumnType, TagDef } from '../types';
import { columnTypeMap } from '../utils/type-mapping';
import { normalizeName } from '../utils/normalize-name';

const DB_FOLDER = path.resolve('./databases');

const untouchable = ['id', 'title', 'content', 'date_created', 'date_modified', 'hidden'];

// Creates a column
export function createColumn(
    dbId: string,
    tableName: string,
    rawName: string,
    customType: string,
    hidden = false,
    index?: number
): ColumnDef {
    const columnName = normalizeName(rawName);

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

    // Determine index
    const currentColumnCount = Object.keys(columns).length;
    const assignedIndex = typeof index === 'number' ? index : currentColumnCount;

    columns[columnName] = {
        type: customType as ColumnType,
        hidden,
        index: assignedIndex,
        ...(customType === 'multi_tag' || customType === 'single_tag'
            ? { tags: [] as TagDef[] }
            : {}),
        ...(customType === 'custom' ? { rule: '' } : {}),
    };

    metadata.modifiedAt = new Date().toISOString();

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return { name: columnName, type: customType as ColumnType, hidden, index: assignedIndex };
}

// Gets all columns from a table
export function getAllColumns(dbId: string, tableName: string): ColumnDef[] {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
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
        };

        // Include tags array if it's a tag column
        if (colDef.type === 'single_tag' || colDef.type === 'multi_tag') {
            baseDef.tags = Array.isArray(colDef.tags) ? colDef.tags : [];
        }

        // Include rule if it exists
        if (colDef.rule !== undefined) {
            baseDef.rule = colDef.rule;
        }

        return baseDef;
    });
}

// Gets a column from a table
export function getSingleColumn(dbId: string, tableName: string, columnName: string): ColumnDef {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
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
    };

    // Include tags array if it's a tag column
    if (colDef.type === 'single_tag' || colDef.type === 'multi_tag') {
        result.tags = Array.isArray(colDef.tags) ? colDef.tags : [];
    }

    // Include rule if it exists
    if (colDef.rule !== undefined) {
        result.rule = colDef.rule;
    }

    return result;
}

// Updates name, or deletes old column and creates a new column with a name and type
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
    const finalName = newName ? normalizeName(newName) : oldName;

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

        columns[nameForTypeChange] = {
            type: newType as ColumnType,
            hidden: currentDef.hidden ?? false,
            index: currentDef.index ?? -1,
            ...(newType === 'tags' ? { tags: [] as TagDef[] } : {}),
            ...(newType === 'custom' ? { rule: currentDef.rule ?? '' } : {}),
        };
    }

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return {
        name: finalName,
        type: columns[finalName].type,
        hidden: columns[finalName].hidden ?? false,
        index: typeof columns[finalName].index === 'number' ? columns[finalName].index : -1,
    };
}

// changes column visibility
export function updateColumnVisibility(
    dbId: string,
    tableName: string,
    rawName: string,
    hidden: boolean
): ColumnDef {
    const columnName = normalizeName(rawName);

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
        index: typeof columns[columnName].index === 'number' ? columns[columnName].index : -1,
    };
}

// Swap index of two columns in a table metadata
export function swapColumnIndex(dbId: string, tableName: string, colName: string, targetIndex: number): void {
    const columnName = normalizeName(colName);

    if (untouchable.includes(columnName))
        throw new Error(`Column '${columnName}' is protected and cannot be reordered.`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const sourceIndex = columns[columnName].index;
    if (typeof sourceIndex !== 'number' || sourceIndex < 0)
        throw new Error(`Invalid index for column '${columnName}'`);

    // Find column with targetIndex
    const targetEntry = Object.entries(columns).find(([, colDef]) => colDef.index === targetIndex);
    if (!targetEntry)
        throw new Error(`No column found with order ${targetIndex}`);

    const [targetColumnName, targetColDef] = targetEntry;

    // Swap indexes
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

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath))
        throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const columns = metadata.tables?.[tableName]?.columns;
    if (!columns?.[columnName])
        throw new Error(`Column '${columnName}' not found in metadata.`);

    const oldIndex = columns[columnName].index;
    if (typeof oldIndex !== 'number' || oldIndex < 0)
        throw new Error(`Invalid index for column '${columnName}'`);

    if (oldIndex === newIndex) return; // no move needed

    // Shift other columns' indexes accordingly
    for (const [, colDef] of Object.entries(columns)) {
        if (typeof colDef.index !== 'number' || colDef.index < 0) continue;

        if (oldIndex < newIndex) {
            // moving down — decrement indexes between oldIndex+1 and newIndex
            if (colDef.index > oldIndex && colDef.index <= newIndex) {
                colDef.index--;
            }
        } else {
            // moving up — increment indexes between newIndex and oldIndex-1
            if (colDef.index >= newIndex && colDef.index < oldIndex) {
                colDef.index++;
            }
        }
    }

    // Set the column's index to newIndex
    columns[columnName].index = newIndex;

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// Adds a tag to a list of possible tags
export function registerTag(
    dbId: string,
    tableName: string,
    columnName: string,
    tagName: string,
    description: string = ''
): void {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const column = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found`);
    if (column.type !== 'single_tag' && column.type !== 'multi_tag') throw new Error(`Column '${columnName}' is not of type 'tags'`);

    const normalizedName = normalizeName(tagName);

    column.tags ??= [];
    if (column.tags.some(t => t.name === normalizedName)) {
        throw new Error(`Tag '${normalizedName}' already exists in column '${columnName}'`);
    }

    column.tags.push({
        name: normalizedName,
        description: description.trim()
    });

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

// removes a tag from a list of possible tags
export function unregisterTag(
    dbId: string,
    tableName: string,
    columnName: string,
    tagName: string
): void {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const column = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found`);
    if (column.type === 'single_tag' || column.type === 'multi_tag') throw new Error(`Column '${columnName}' is not of type 'tags'`);

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
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata file not found for '${dbId}'`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta) throw new Error(`Table '${tableName}' not found in metadata.`);

    const column = tableMeta.columns?.[columnName];
    if (!column) throw new Error(`Column '${columnName}' not found in metadata.`);
    if (column.type !== 'custom') throw new Error(`Only custom columns can have regex rules.`);

    // Validate regex
    try {
        new RegExp(rule);
    } catch {
        throw new Error(`Invalid regex expression: '${rule}'`);
    }

    // Update rule and save metadata
    column.rule = rule;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}


// Deletes unprotected column
export function deleteColumn(dbId: string, tableName: string, rawName: string): void {
    const columnName = normalizeName(rawName);

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

    const deletedIndex = typeof columns[columnName].index === 'number' ? columns[columnName].index : -1;

    const db = new Database(dbPath);
    try {
        db.prepare(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`).run();
    } catch (err) {
        throw new Error(`Failed to drop column '${columnName}': ${(err as Error).message}`);
    }

    // Remove the deleted column metadata
    delete columns[columnName];

    // Shift index down by 1 for columns with index > deletedIndex
    if (deletedIndex >= 0) {
        for (const [colName, colDef] of Object.entries(columns)) {
            if (typeof colDef.index === 'number' && colDef.index > deletedIndex) {
                colDef.index = colDef.index - 1;
            }
        }
    }

    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}
