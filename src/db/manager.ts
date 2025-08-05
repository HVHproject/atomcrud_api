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

export function listDatabases(): {
    id: string,
    dateCreated: number,
    dateModified: number,
    dateCreatedReadable: string,
    dateModifiedReadable: string
}[] {
    const files = fs.readdirSync(DB_FOLDER);

    return files
        .filter(file => file.endsWith('.sqlite'))
        .map(file => {
            const id = path.basename(file, '.sqlite');
            const fullPath = path.join(DB_FOLDER, file);
            const stats = fs.statSync(fullPath);
            return {
                id,
                dateCreated: stats.ctimeMs,
                dateModified: stats.mtimeMs,
                dateCreatedReadable: new Date(stats.ctimeMs).toLocaleString(),
                dateModifiedReadable: new Date(stats.mtimeMs).toLocaleString()
            };
        });
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

  CREATE TABLE IF NOT EXISTS column_metadata (
    column_name TEXT PRIMARY KEY,
    column_type TEXT
  );
`);
    const insertMeta = db.prepare(`
  INSERT OR REPLACE INTO column_metadata (column_name, column_type) VALUES (?, ?)
`);

    insertMeta.run('id', 'integer');
    insertMeta.run('title', 'string');
    insertMeta.run('content', 'rich_text');
    insertMeta.run('date_created', 'date');
    insertMeta.run('date_updated', 'date');
    insertMeta.run('hidden', 'boolean');
    db.close();

    return { id, filePath };
}

export function getDatabaseContents(dbId: string) {
    const filePath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Database '${dbId}' does not exist.`);
    }

    const db = new Database(filePath);

    // Entries
    const entryRows = db.prepare(`SELECT * FROM entries`).all();
    const entryCols = db.prepare(`PRAGMA table_info(entries)`).all().map((col: any) => ({
        name: col.name,
        type: col.type,
    }));

    // Metadata
    const metaRows = db.prepare(`SELECT * FROM column_metadata`).all();
    const metaCols = db.prepare(`PRAGMA table_info(column_metadata)`).all().map((col: any) => ({
        name: col.name,
        type: col.type,
    }));

    db.close();

    return {
        entries: {
            columns: entryCols,
            rows: entryRows,
        },
        column_metadata: {
            columns: metaCols,
            rows: metaRows,
        }
    };
}

export function deleteDatabase(dbId: string): { success: boolean; message: string } {
    const filePath = path.join(DB_FOLDER, `${dbId}.sqlite`);

    if (!fs.existsSync(filePath)) {
        return { success: false, message: `Database '${dbId}' does not exist.` };
    }

    try {
        fs.unlinkSync(filePath);
        return { success: true, message: `Database '${dbId}' was deleted.` };
    } catch (error: any) {
        return { success: false, message: `Failed to delete database '${dbId}': ${error.message}` };
    }
}

