import fs from 'fs';
import path from 'path';

const DB_FOLDER = path.resolve('./databases');
const BACKUP_FOLDER = path.resolve('./backup');

// Ensure backup folder exists
function ensureBackupFolder() {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        fs.mkdirSync(BACKUP_FOLDER);
    }
}

// Create a backup
export function backupDatabase(dbId: string): { success: boolean; message: string; backupName?: string } {
    ensureBackupFolder();

    const dbPath = path.join(DB_FOLDER, `${dbId}.sqlite`);
    const metaPath = path.join(DB_FOLDER, `${dbId}.meta.json`);

    if (!fs.existsSync(dbPath)) return { success: false, message: `Database '${dbId}' not found.` };
    if (!fs.existsSync(metaPath)) return { success: false, message: `Metadata for '${dbId}' not found.` };

    const timestamp = Date.now();
    const baseName = dbId.replace(/^backup_|^restored_/, '');
    const backupName = `backup_${baseName.split('_')[0]}_${timestamp}`;

    const backupDbPath = path.join(BACKUP_FOLDER, `${backupName}.sqlite`);
    const backupMetaPath = path.join(BACKUP_FOLDER, `${backupName}.meta.json`);

    try {
        fs.copyFileSync(dbPath, backupDbPath);
        fs.copyFileSync(metaPath, backupMetaPath);

        const metadata = JSON.parse(fs.readFileSync(backupMetaPath, 'utf-8'));
        metadata.id = backupName;
        metadata.modifiedAt = new Date(timestamp).toISOString();
        fs.writeFileSync(backupMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');

        return { success: true, message: `Backup created successfully.`, backupName };
    } catch (err: any) {
        return { success: false, message: `Backup failed: ${err.message}` };
    }
}

// List available backups
export function listBackups(): { success: boolean; backups?: string[]; message?: string } {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        return { success: false, backups: [], message: 'No backup folder found.' };
    }

    const files = fs.readdirSync(BACKUP_FOLDER);
    const backups = files
        .filter(file => file.endsWith('.sqlite'))
        .map(file => path.basename(file, '.sqlite'));

    return { success: true, backups };
}

// Recover a backup
export function recoverBackup(backupName: string): { success: boolean; message: string; newName?: string } {
    ensureBackupFolder();

    const backupDbPath = path.join(BACKUP_FOLDER, `${backupName}.sqlite`);
    const backupMetaPath = path.join(BACKUP_FOLDER, `${backupName}.meta.json`);

    if (!fs.existsSync(backupDbPath)) {
        return { success: false, message: `Backup '${backupName}' not found.` };
    }

    const baseName = backupName.replace(/^backup_/, '');
    const newName = `restored_${baseName}`;
    const newDbPath = path.join(DB_FOLDER, `${newName}.sqlite`);
    const newMetaPath = path.join(DB_FOLDER, `${newName}.meta.json`);

    try {
        fs.copyFileSync(backupDbPath, newDbPath);
        if (fs.existsSync(backupMetaPath)) {
            fs.copyFileSync(backupMetaPath, newMetaPath);

            const metadata = JSON.parse(fs.readFileSync(newMetaPath, 'utf-8'));
            metadata.id = newName;
            metadata.modifiedAt = new Date().toISOString();
            fs.writeFileSync(newMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');
        }

        return { success: true, message: `Recovered backup as '${newName}'.`, newName };
    } catch (err: any) {
        return { success: false, message: `Recovery failed: ${err.message}` };
    }
}

// Delete a backup
export function deleteBackup(backupName: string): { success: boolean; message: string } {
    if (!fs.existsSync(BACKUP_FOLDER)) {
        return { success: false, message: 'Backup folder does not exist.' };
    }

    const backupDbPath = path.join(BACKUP_FOLDER, `${backupName}.sqlite`);
    const backupMetaPath = path.join(BACKUP_FOLDER, `${backupName}.meta.json`);

    if (!fs.existsSync(backupDbPath)) {
        return { success: false, message: `Backup '${backupName}' not found.` };
    }

    try {
        fs.unlinkSync(backupDbPath);
        if (fs.existsSync(backupMetaPath)) fs.unlinkSync(backupMetaPath);
        return { success: true, message: `Backup '${backupName}' deleted.` };
    } catch (err: any) {
        return { success: false, message: `Failed to delete backup: ${err.message}` };
    }
}
