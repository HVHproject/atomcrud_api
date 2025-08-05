import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_FOLDER = path.resolve('./databases');

if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER);
}

function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 30); // limit length
}

export function createDatabase(displayName: string): { id: string, filePath: string } {
    const safeName = sanitizeName(displayName);
    const timestamp = Date.now();
    const id = `${safeName}_${timestamp}`;
    const filePath = path.join(DB_FOLDER, `${id}.sqlite`);

    const db = new Database(filePath);
    db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT,
      date_created INTEGER,
      date_updated INTEGER,
      hidden BOOLEAN DEFAULT 0
    );
  `);
    db.close();

    return { id, filePath };
}

export function getDatabaseContents(dbId: string) {
    const filePath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Database '${dbId}' does not exist.`);
    }

    const db = new Database(filePath);
    const stmt = db.prepare(`SELECT * FROM entries`);
    const rows = stmt.all();

    const columnInfo = db.prepare(`PRAGMA table_info(entries)`).all();
    const columns = columnInfo.map((col: any) => ({
        name: col.name,
        type: col.type,
    }));

    db.close();
    return { columns, rows };
}
