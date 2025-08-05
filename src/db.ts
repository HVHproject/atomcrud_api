import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';

type DatabaseType = InstanceType<typeof Database>

export function getAllRecords(filePath: string) {
    if (!fs.existsSync(filePath)) throw new Error('DB file does not exist');

    const db = new Database(filePath);
    const tableName = getMainTableName(db);

    const stmt = db.prepare(`SELECT * FROM ${tableName}`);
    const rows = stmt.all();
    db.close();
    return rows;
}

function getMainTableName(db: DatabaseType): string {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return tables[0]?.name ?? '';
}
