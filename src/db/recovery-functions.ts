import fs from 'fs';
import path from 'path';
import { BACKUP_FOLDER, getDbPaths, getBackupPaths } from '../utils/db-paths';

function ensureBackupFolder() {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        fs.mkdirSync(BACKUP_FOLDER, { recursive: true });
    }
}

/**
 * Creates a backup of a database.
 *
 * Backup folder structure mirrors the main database structure:
 *   backup/
 *     backup_{safeName}_{timestamp}/
 *       {safeName}.sqlite
 *       {safeName}.meta.json
 *       Gallery/              ← copied from source if present
 */
export function backupDatabase(dbId: string): { success: boolean; message: string; backupName?: string } {
    ensureBackupFolder();

    const { dbPath, metaPath, galleryPath: srcGalleryPath, safeName: srcSafeName } = getDbPaths(dbId);

    if (!fs.existsSync(dbPath)) return { success: false, message: `Database '${dbId}' not found.` };
    if (!fs.existsSync(metaPath)) return { success: false, message: `Metadata for '${dbId}' not found.` };

    // Derive base safe name — strip any existing backup_ / restored_ prefixes
    const baseSafeName = srcSafeName.replace(/^(backup_|restored_)+/, '');
    const timestamp = Date.now();
    const backupName = `backup_${baseSafeName}_${timestamp}`;

    const { folderPath, dbPath: bkDbPath, metaPath: bkMetaPath, galleryPath: bkGalleryPath } = getBackupPaths(backupName);

    try {
        fs.mkdirSync(folderPath, { recursive: true });
        fs.mkdirSync(bkGalleryPath, { recursive: true });

        fs.copyFileSync(dbPath, bkDbPath);
        fs.copyFileSync(metaPath, bkMetaPath);

        // Copy Gallery contents if present
        if (fs.existsSync(srcGalleryPath)) {
            fs.cpSync(srcGalleryPath, bkGalleryPath, { recursive: true });
        }

        // Update id and timestamp in the backup's metadata
        const metadata = JSON.parse(fs.readFileSync(bkMetaPath, 'utf-8'));
        metadata.id = backupName;
        metadata.modifiedAt = new Date(timestamp).toISOString();
        fs.writeFileSync(bkMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');

        return { success: true, message: `Backup created successfully.`, backupName };
    } catch (err: any) {
        // Clean up partial backup folder on failure
        if (fs.existsSync(folderPath)) {
            try { fs.rmSync(folderPath, { recursive: true, force: true }); } catch {}
        }
        return { success: false, message: `Backup failed: ${err.message}` };
    }
}

// List available backups (returns folder names)
export function listBackups(): { success: boolean; backups?: string[]; message?: string } {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        return { success: false, backups: [], message: 'No backup folder found.' };
    }

    const entries = fs.readdirSync(BACKUP_FOLDER, { withFileTypes: true });
    const backups = entries
        .filter(e => e.isDirectory() && e.name.startsWith('backup_'))
        .map(e => e.name);

    return { success: true, backups };
}

/**
 * Recovers a backup into the databases folder using the full folder structure.
 * The restored database gets a new ID: restored_{safeName}_{timestamp}
 */
export function recoverBackup(backupName: string): { success: boolean; message: string; newName?: string } {
    ensureBackupFolder();

    const { folderPath: bkFolder, dbPath: bkDbPath, metaPath: bkMetaPath, galleryPath: bkGalleryPath } = getBackupPaths(backupName);

    if (!fs.existsSync(bkFolder)) {
        return { success: false, message: `Backup '${backupName}' not found.` };
    }
    if (!fs.existsSync(bkDbPath)) {
        return { success: false, message: `Backup database file for '${backupName}' not found.` };
    }

    // Derive base safe name from backup name, then build a restored_ id
    const withoutPrefix = backupName.replace(/^backup_/, '');
    const strippedParts = withoutPrefix.split('_');
    const baseSafeName = strippedParts.slice(0, -1).join('_');
    const timestamp = Date.now();
    const newId = `restored_${baseSafeName}_${timestamp}`;

    const { folderPath: newFolderPath, dbPath: newDbPath, metaPath: newMetaPath, galleryPath: newGalleryPath } = getDbPaths(newId);

    try {
        fs.mkdirSync(newFolderPath, { recursive: true });
        fs.mkdirSync(newGalleryPath, { recursive: true });

        fs.copyFileSync(bkDbPath, newDbPath);

        if (fs.existsSync(bkMetaPath)) {
            fs.copyFileSync(bkMetaPath, newMetaPath);
            const metadata = JSON.parse(fs.readFileSync(newMetaPath, 'utf-8'));
            metadata.id = newId;
            metadata.modifiedAt = new Date(timestamp).toISOString();
            fs.writeFileSync(newMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');
        }

        // Copy Gallery contents from backup if any
        if (fs.existsSync(bkGalleryPath)) {
            fs.cpSync(bkGalleryPath, newGalleryPath, { recursive: true });
        }

        return { success: true, message: `Recovered backup as '${newId}'.`, newName: newId };
    } catch (err: any) {
        // Clean up partial restore folder on failure
        if (fs.existsSync(newFolderPath)) {
            try { fs.rmSync(newFolderPath, { recursive: true, force: true }); } catch {}
        }
        return { success: false, message: `Recovery failed: ${err.message}` };
    }
}

// Delete a backup folder
export function deleteBackup(backupName: string): { success: boolean; message: string } {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        return { success: false, message: 'Backup folder does not exist.' };
    }

    const { folderPath } = getBackupPaths(backupName);

    if (!fs.existsSync(folderPath)) {
        return { success: false, message: `Backup '${backupName}' not found.` };
    }

    try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        return { success: true, message: `Backup '${backupName}' deleted.` };
    } catch (err: any) {
        return { success: false, message: `Failed to delete backup: ${err.message}` };
    }
}
