import Database from 'better-sqlite3';
import fs from 'fs';

export function getAllRecords(filePath: string) {
    if (!fs.existsSync(filePath)) throw new Error('DB file does not exist');

    const db = new Database(filePath);
    const tableName = getMainTableName(db);

    const stmt = db.prepare(`SELECT * FROM ${tableName}`);
    const rows = stmt.all();
    db.close();
    return rows;
}

function getMainTableName(db: Database.Database): string {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    // Assuming one main table; otherwise, adjust logic
    return tables[0]?.name ?? '';
}
