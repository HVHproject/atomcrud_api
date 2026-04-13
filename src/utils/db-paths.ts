import fs from 'fs';
import path from 'path';

export const DB_FOLDER = path.resolve('./databases');
export const BACKUP_FOLDER = path.resolve('./backup');

if (!fs.existsSync(DB_FOLDER)) {
    fs.mkdirSync(DB_FOLDER, { recursive: true });
}

/**
 * Given a database ID (format: {safeName}_{timestamp}),
 * derives the folder and file paths for all database assets.
 *
 * Structure on disk:
 *   databases/
 *     {safeName}_{timestamp}/         <- folder (the DB id)
 *       {safeName}.sqlite             <- SQLite database
 *       {safeName}.meta.json          <- metadata
 *       Gallery/                      <- reserved for media assets
 */
export function getDbPaths(dbId: string) {
    const parts = dbId.split('_');
    // Last segment is the numeric timestamp; everything before it is the safe name
    const safeName = parts.slice(0, -1).join('_');
    const folderPath = path.join(DB_FOLDER, dbId);
    const dbPath = path.join(folderPath, `${safeName}.sqlite`);
    const metaPath = path.join(folderPath, `${safeName}.meta.json`);
    const galleryPath = path.join(folderPath, 'Gallery');
    return { folderPath, safeName, dbPath, metaPath, galleryPath };
}

/**
 * Given a backup name (format: backup_{safeName}_{timestamp}),
 * derives the folder and file paths for backup assets.
 *
 * Structure on disk:
 *   backup/
 *     backup_{safeName}_{timestamp}/  <- backup folder (the backup ID)
 *       {safeName}.sqlite
 *       {safeName}.meta.json
 *       Gallery/                      <- copied from source if present
 */
export function getBackupPaths(backupName: string) {
    const folderPath = path.join(BACKUP_FOLDER, backupName);
    // Strip leading "backup_" prefix, then derive safeName as everything before the last _timestamp
    const withoutPrefix = backupName.replace(/^backup_/, '');
    const parts = withoutPrefix.split('_');
    const safeName = parts.slice(0, -1).join('_');
    const dbPath = path.join(folderPath, `${safeName}.sqlite`);
    const metaPath = path.join(folderPath, `${safeName}.meta.json`);
    const galleryPath = path.join(folderPath, 'Gallery');
    return { folderPath, safeName, dbPath, metaPath, galleryPath };
}
