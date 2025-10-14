import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { DatabaseMetadata, ColumnDef } from '../types';
import { normalizeName } from '../utils/normalize-name';
import { processTagValue } from '../utils/process-tag-value';

const DB_FOLDER = path.resolve('./databases');
if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER);
}

function validateColumnValue(colMeta: ColumnDef, value: any): any {
    const { type } = colMeta;

    switch (type) {
        case 'string':
        case 'rich_text':
            return value;

        case 'boolean':
            if (value !== 0 && value !== 1) {
                throw new Error(`Value for boolean column must be 0 or 1, got: ${value}`);
            }
            return value;

        case 'integer':
            if (!Number.isInteger(value)) {
                throw new Error(`Value for integer column must be an integer, got: ${value}`);
            }
            return value;

        case 'float':
            if (typeof value !== 'number') {
                throw new Error(`Value for float column must be a number, got: ${value}`);
            }
            return value;

        case 'date':
            if (typeof value !== 'number' || value <= 0) {
                throw new Error(`Value for date column must be a positive number (timestamp), got: ${value}`);
            }
            return value;

        case 'rating':
            if (!Number.isInteger(value) || value < 0 || value > 5) {
                throw new Error(`Value for rating column must be an integer 0-5, got: ${value}`);
            }
            return value;

        case 'advanced_rating':
            if (typeof value !== 'number' || value < 0 || value > 10) {
                throw new Error(`Value for advanced_rating column must be a number 0.0-10.0, got: ${value}`);
            }
            return value;

        case 'multi_tag':
        case 'single_tag':
            return processTagValue(colMeta as any, value);

        case 'custom':
            if (typeof value !== 'string') {
                throw new Error(`Value for custom column must be a string, got: ${typeof value}`);
            }
            if (colMeta.rule) {
                let regex: RegExp;
                try {
                    regex = new RegExp(colMeta.rule);
                } catch {
                    throw new Error(`Invalid regex rule for column: ${colMeta.rule}`);
                }
                if (!regex.test(value)) {
                    throw new Error(`Value '${value}' does not match custom rule.`);
                }
            }
            return value;

        case 'link':
            if (typeof value !== 'string') {
                throw new Error(`Value for link column must be a JSON string, got: ${value}`);
            }
            try {
                const parsed = JSON.parse(value);
                if (
                    typeof parsed !== 'object' ||
                    typeof parsed.displayName !== 'string' ||
                    typeof parsed.url !== 'string'
                ) {
                    throw new Error();
                }
            } catch {
                throw new Error(`Invalid JSON format for link column. Expected {displayName: string, url: string}`);
            }
            return value;

        default:
            throw new Error(`Unknown column type: ${type}`);
    }
}


// POST create a new row
export function createRow(dbId: string, tableName: string, data: Record<string, any>) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta) throw new Error(`Table '${tableName}' not found`);

    // Normalize incoming column keys
    const normalizedData: Record<string, any> = {};
    for (const key of Object.keys(data)) {
        if (key === 'date_modified') continue;
        normalizedData[normalizeName(key)] = data[key];
    }

    // Ensure title is provided and not just whitespace
    if (!normalizedData.title || String(normalizedData.title).trim() === '') {
        throw new Error(`Title is required and cannot be blank`);
    }

    // Default values
    const now = Date.now();
    const rowData: Record<string, any> = {
        id: undefined,
        title: normalizedData.title,
        content: normalizedData.content,
        date_created: normalizedData.date_created ?? now,
        date_modified: now,
        hidden: 0,
    };

    // Validate and populate all columns
for (const [colName, colMeta] of Object.entries(tableMeta.columns)) {
    if (colName === "id") continue;

    if (colName in normalizedData) {
        rowData[colName] = validateColumnValue(
            { ...colMeta, name: colName } as ColumnDef,
            normalizedData[colName]
        );
    } else if (!(colName in rowData)) {
        continue;
    }
}

    const db = new Database(dbPath);
    const colNames = Object.keys(rowData).filter(k => rowData[k] !== undefined);
    const placeholders = colNames.map(() => '?').join(', ');
    const stmt = db.prepare(
        `INSERT INTO "${tableName}" (${colNames.join(', ')}) VALUES (${placeholders})`
    );
    const info = stmt.run(colNames.map(k => rowData[k]));
    db.close();

    return getSingleRow(dbId, tableName, String(info.lastInsertRowid));
}

// GET a single row
export function getSingleRow(dbId: string, tableName: string, rowId: string) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found`);

    const db = new Database(dbPath);
    const stmt = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`);
    const row = stmt.get(rowId);
    db.close();

    if (!row) throw new Error(`Row with ID '${rowId}' not found`);
    return row;
}

// PATCH visibility of a row
export function patchRowVisibility(dbId: string, tableName: string, rowId: string, hiddenValue: number) {
    if (hiddenValue !== 0 && hiddenValue !== 1) {
        throw new Error('Invalid hidden value. Must be 0 or 1.');
    }

    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found`);

    // Check table metadata to ensure 'hidden' column exists and is boolean/integer
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);
    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta) throw new Error(`Table '${tableName}' not found`);
    if (!tableMeta.columns?.hidden || tableMeta.columns.hidden.type !== 'boolean') {
        throw new Error(`Table '${tableName}' does not have a boolean 'hidden' column`);
    }

    const db = new Database(dbPath);
    const now = Date.now();

    // Update hidden and date_modified
    const stmt = db.prepare(`
        UPDATE "${tableName}" 
        SET hidden = ?, date_modified = ?
        WHERE id = ?
    `);
    const result = stmt.run(hiddenValue, now, rowId);
    db.close();

    if (result.changes === 0) {
        throw new Error(`Row with ID '${rowId}' not found`);
    }

    return getSingleRow(dbId, tableName, rowId);
}

// PATCH Row data
export function patchRow(dbId: string, tableName: string, rowId: string, data: Record<string, any>) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found`);

    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for database '${dbId}' not found`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta) throw new Error(`Table '${tableName}' not found`);

    // Normalize keys and exclude disallowed fields
    const normalizedData: Record<string, any> = {};
    for (const key of Object.keys(data)) {
        if (['id', 'date_modified', 'hidden'].includes(key)) continue;
        normalizedData[normalizeName(key)] = data[key];
    }

    // Validate columns in normalizedData
    for (const [colName, value] of Object.entries(normalizedData)) {
        const colMeta = tableMeta.columns[colName];
        if (!colMeta) {
            throw new Error(`Column '${colName}' does not exist in table '${tableName}'`);
        }
        normalizedData[colName] = validateColumnValue(
            { ...colMeta, name: colName } as ColumnDef,
            normalizedData[colName]
        );
    }

    // If title is being updated, ensure not blank
    if ('title' in normalizedData && String(normalizedData.title).trim() === '') {
        throw new Error('Title cannot be blank');
    }

    // Build SET clause dynamically
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [colName, value] of Object.entries(normalizedData)) {
        setClauses.push(`"${colName}" = ?`);
        values.push(value);
    }

    // Always update date_modified
    setClauses.push(`date_modified = ?`);
    values.push(Date.now());

    if (setClauses.length === 0) {
        throw new Error('No valid fields provided for update');
    }

    values.push(rowId);

    const db = new Database(dbPath);
    const stmt = db.prepare(`
    UPDATE "${tableName}"
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);
    const result = stmt.run(...values);
    db.close();

    if (result.changes === 0) {
        throw new Error(`Row with ID '${rowId}' not found`);
    }

    return getSingleRow(dbId, tableName, rowId);
}


// DELETE a row
export function deleteRow(dbId: string, tableName: string, rowId: string) {
    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(dbPath)) throw new Error(`Database '${dbId}' not found`);

    const db = new Database(dbPath);
    const stmt = db.prepare(`DELETE FROM "${tableName}" WHERE id = ?`);
    const result = stmt.run(rowId);
    db.close();

    if (result.changes === 0) throw new Error(`Row with ID '${rowId}' not found`);
}