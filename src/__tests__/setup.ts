import fs from 'fs';
import path from 'path';
import os from 'os';

// Set env vars BEFORE any module that imports db-paths.ts is loaded.
// Vitest loads setupFiles before test files, so this runs first.
const testRoot = path.join(os.tmpdir(), `atomcrud_test_${process.pid}`);
const testDbFolder = path.join(testRoot, 'databases');
const testBackupFolder = path.join(testRoot, 'backup');

process.env.ATOMCRUD_TEST_DB_FOLDER = testDbFolder;
process.env.ATOMCRUD_TEST_BACKUP_FOLDER = testBackupFolder;

fs.mkdirSync(testDbFolder, { recursive: true });
fs.mkdirSync(testBackupFolder, { recursive: true });

// Clean up after all tests in the suite finish
afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
});
