import path from 'path';
import fs from 'fs';
import { DatabaseMetadata, ColumnDef } from '../types/types';

const DB_FOLDER = path.resolve('./databases');

export function getAllColumns(dbId: string, tableName: string): ColumnDef[] {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta || !tableMeta.columns) throw new Error(`Table '${tableName}' or its columns not found in metadata.`);

    return Object.entries(tableMeta.columns).map(([name, colDef]): ColumnDef => {
        if (typeof colDef === 'string') {
            return { name, type: colDef, hidden: false };
        }
        return {
            name,
            type: colDef.type,
            hidden: colDef.hidden ?? false,
        };
    });
}

export function getSingleColumn(dbId: string, tableName: string, columnName: string): ColumnDef {
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);
    if (!fs.existsSync(metaPath)) throw new Error(`Metadata for '${dbId}' not found.`);

    const metadata: DatabaseMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const tableMeta = metadata.tables?.[tableName];
    if (!tableMeta || !tableMeta.columns?.[columnName]) throw new Error(`Column '${columnName}' not found in table '${tableName}'`);

    const colDef = tableMeta.columns[columnName];
    if (typeof colDef === 'string') {
        return { name: columnName, type: colDef, hidden: false };
    }
    return {
        name: columnName,
        type: colDef.type,
        hidden: colDef.hidden ?? false,
    };
}
