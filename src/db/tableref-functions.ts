import fs from 'fs';
import Database from 'better-sqlite3';
import type { DatabaseMetadata } from '../types';
import { getDbPaths } from '../utils/db-paths';

/**
 * Sets the target table for a table_ref or table_ref_many column.
 * Pass an empty string to clear/unconfigure the link.
 */
export function setTableRefTarget(
    dbId: string,
    tableName: string,
    columnName: string,
    targetTable: string
): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const col = metadata.tables?.[tableName]?.columns?.[columnName];
    if (!col) throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);
    if (col.type !== 'table_ref' && col.type !== 'table_ref_many')
        throw new Error(`Column '${columnName}' is not a table_ref or table_ref_many column.`);
    if (targetTable !== '' && !metadata.tables?.[targetTable])
        throw new Error(`Target table '${targetTable}' does not exist in this database.`);
    if (targetTable === tableName)
        throw new Error(`A table cannot reference itself.`);

    col.linkedTable = targetTable;
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * When a row is deleted, null out all table_ref/table_ref_many columns across
 * all tables in the same DB that held a reference to that row's ID.
 */
export function cascadeNullOnRowDelete(
    dbId: string,
    deletedTable: string,
    deletedRowId: number
): void {
    const { dbPath, metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath)) return;

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!metadata.tables) return;

    const db = new Database(dbPath);
    const now = Date.now();

    try {
        for (const [tName, tMeta] of Object.entries(metadata.tables)) {
            if (!tMeta.columns) continue;
            for (const [cName, cDef] of Object.entries(tMeta.columns)) {
                if (cDef.linkedTable !== deletedTable) continue;

                if (cDef.type === 'table_ref') {
                    db.prepare(
                        `UPDATE "${tName}" SET "${cName}" = NULL, date_modified = ? WHERE "${cName}" = ?`
                    ).run(now, deletedRowId);
                } else if (cDef.type === 'table_ref_many') {
                    // Parse each row's JSON array and filter out the deleted ID
                    const rows = db.prepare(
                        `SELECT id, "${cName}" FROM "${tName}" WHERE "${cName}" IS NOT NULL AND "${cName}" != ''`
                    ).all() as Array<{ id: number; [key: string]: any }>;

                    for (const row of rows) {
                        let ids: number[];
                        try { ids = JSON.parse(row[cName]); } catch { continue; }
                        const filtered = ids.filter(id => id !== deletedRowId);
                        const newVal = filtered.length > 0 ? JSON.stringify(filtered) : null;
                        db.prepare(
                            `UPDATE "${tName}" SET "${cName}" = ?, date_modified = ? WHERE id = ?`
                        ).run(newVal, now, row.id);
                    }
                }
            }
        }
    } finally {
        db.close();
    }
}

/**
 * When a table is deleted, clear linkedTable on all columns that pointed to it
 * and NULL out the stored values in SQLite so nothing is left dangling.
 */
export function cascadeOnTableDelete(dbId: string, deletedTable: string): void {
    const { dbPath, metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath) || !fs.existsSync(dbPath)) return;

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!metadata.tables) return;

    const db = new Database(dbPath);
    const now = Date.now();
    let metaChanged = false;

    try {
        for (const [tName, tMeta] of Object.entries(metadata.tables)) {
            if (tName === deletedTable) continue;
            if (!tMeta.columns) continue;
            for (const [cName, cDef] of Object.entries(tMeta.columns)) {
                if (cDef.linkedTable !== deletedTable) continue;
                if (cDef.type !== 'table_ref' && cDef.type !== 'table_ref_many') continue;

                db.prepare(
                    `UPDATE "${tName}" SET "${cName}" = NULL, date_modified = ? WHERE "${cName}" IS NOT NULL`
                ).run(now);

                cDef.linkedTable = '';
                metaChanged = true;
            }
        }
    } finally {
        db.close();
    }

    if (metaChanged) {
        metadata.modifiedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    }
}

/**
 * When a table is renamed, update linkedTable on all columns that pointed to
 * the old name so references stay valid.
 */
export function cascadeOnTableRename(dbId: string, oldTable: string, newTable: string): void {
    const { metaPath } = getDbPaths(dbId);
    if (!fs.existsSync(metaPath)) return;

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!metadata.tables) return;

    let metaChanged = false;

    for (const [, tMeta] of Object.entries(metadata.tables)) {
        if (!tMeta.columns) continue;
        for (const [, cDef] of Object.entries(tMeta.columns)) {
            if (cDef.linkedTable === oldTable) {
                cDef.linkedTable = newTable;
                metaChanged = true;
            }
        }
    }

    if (metaChanged) {
        metadata.modifiedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    }
}
