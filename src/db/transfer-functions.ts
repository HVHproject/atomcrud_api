/**
 * Transfer helpers: copy rows between tables, copy columns, and suggest
 * column mappings between tables with potentially different schemas.
 *
 * Column Mapping Logic
 * ────────────────────
 * Types are matched by compatibility rather than strict equality. The
 * matrix below describes what a target type will accept from a source type:
 *
 *   string          ← almost anything (coerced via String())
 *   rich_text       ← rich_text, string, custom
 *   integer         ← integer, boolean (0/1), rating, float (Math.trunc)
 *   float           ← float, integer, rating, advanced_rating
 *   boolean         ← boolean, integer (0/1)
 *   rating          ← rating, integer (clamped 0–5)
 *   advanced_rating ← advanced_rating, float, integer, rating
 *   date            ← date, integer (treated as unix-ms timestamp)
 *   single_tag      ← single_tag, string
 *   multi_tag       ← multi_tag, string
 *   link            ← link, string (must be valid JSON link object)
 *   custom          ← custom, string
 *
 * "Compatibility levels" reported per mapping:
 *   exact      – same name and same type
 *   compatible – same type, different name
 *   coerced    – different but compatible types
 *   string_catch – target is string, accepts anything
 *   none       – no safe mapping found
 */

import fs from 'fs';
import Database from 'better-sqlite3';
import type { ColumnDef, ColumnType, DatabaseMetadata } from '../types';
import { getDbPaths } from '../utils/db-paths';
import { normalizeName } from '../utils/normalize-name';
import { columnTypeMap } from '../utils/type-mapping';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CompatibilityLevel = 'exact' | 'compatible' | 'coerced' | 'string_catch' | 'none';

export interface ColumnMappingEntry {
    /** Column name in the target table */
    targetColumn: string;
    /** Column type in the target table */
    targetType: ColumnType;
    /** Best matching source column name, or null if none found */
    sourceColumn: string | null;
    /** Source column type (if a match was found) */
    sourceType: ColumnType | null;
    /** Quality of the match */
    compatibility: CompatibilityLevel;
    /** Human-readable note about coercion or caveats */
    notes?: string;
}

export interface CopyRowsResult {
    copied: number;
    skipped: number;
    errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a value of `sourceType` can be stored in a column of
 * `targetType` (possibly with coercion).
 */
export function areTypesCompatible(sourceType: ColumnType, targetType: ColumnType): boolean {
    if (sourceType === targetType) return true;

    const matrix: Partial<Record<ColumnType, ColumnType[]>> = {
        string:          ['rich_text', 'custom', 'single_tag', 'multi_tag', 'link', 'integer', 'float', 'boolean', 'rating', 'advanced_rating', 'date'],
        rich_text:       ['string', 'custom'],
        integer:         ['boolean', 'rating', 'float', 'date', 'advanced_rating'],
        float:           ['integer', 'rating', 'advanced_rating'],
        boolean:         ['integer'],
        rating:          ['integer', 'float', 'advanced_rating'],
        advanced_rating: ['float', 'integer', 'rating'],
        date:            ['integer'],
        single_tag:      ['string', 'multi_tag'],
        multi_tag:       ['string', 'single_tag'],
        link:            ['string'],
        custom:          ['string', 'rich_text'],
    };

    return matrix[sourceType]?.includes(targetType) ?? false;
}

/**
 * Describes the compatibility between a source and target type pair.
 */
function compatibilityLevel(sourceType: ColumnType, targetType: ColumnType): CompatibilityLevel {
    if (sourceType === targetType) return 'compatible'; // same type, called after name-check elsewhere
    if (targetType === 'string') return 'string_catch';
    if (areTypesCompatible(sourceType, targetType)) return 'coerced';
    return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Column mapping helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a suggested column mapping from a source table schema to a target
 * table schema.
 *
 * Resolution order for each target column:
 *   1. Manual override (overrides map: { targetColumn: sourceColumn })
 *   2. Exact name + exact type match
 *   3. Exact name + compatible type
 *   4. Best fuzzy name + exact type (Jaro-Winkler > 0.85)
 *   5. First source column with compatible type
 *   6. null (no match)
 *
 * System columns (id, hidden, date_created, date_modified) are excluded from
 * the output — those are handled automatically on insert.
 *
 * @param sourceColumns  Columns from the source table
 * @param targetColumns  Columns from the target table
 * @param overrides      Manual pinning: { targetColumnName: sourceColumnName }
 */
export function buildColumnMapping(
    sourceColumns: ColumnDef[],
    targetColumns: ColumnDef[],
    overrides: Record<string, string> = {}
): ColumnMappingEntry[] {
    const systemCols = new Set(['id', 'hidden', 'date_created', 'date_modified']);

    const mappable = targetColumns.filter(c => !systemCols.has(c.name));
    const sourceMap = new Map(sourceColumns.map(c => [c.name, c]));

    return mappable.map(target => {
        // 1. Manual override
        if (overrides[target.name]) {
            const src = sourceMap.get(overrides[target.name]);
            if (src) {
                const lvl = src.type === target.type ? 'exact' : compatibilityLevel(src.type, target.type);
                return {
                    targetColumn: target.name,
                    targetType: target.type,
                    sourceColumn: src.name,
                    sourceType: src.type,
                    compatibility: lvl,
                    notes: lvl !== 'exact' ? coercionNote(src.type, target.type) : undefined,
                };
            }
        }

        // 2. Exact name + exact type
        const exactMatch = sourceMap.get(target.name);
        if (exactMatch && exactMatch.type === target.type) {
            return {
                targetColumn: target.name,
                targetType: target.type,
                sourceColumn: exactMatch.name,
                sourceType: exactMatch.type,
                compatibility: 'exact',
            };
        }

        // 3. Exact name + compatible type
        if (exactMatch && areTypesCompatible(exactMatch.type, target.type)) {
            return {
                targetColumn: target.name,
                targetType: target.type,
                sourceColumn: exactMatch.name,
                sourceType: exactMatch.type,
                compatibility: compatibilityLevel(exactMatch.type, target.type),
                notes: coercionNote(exactMatch.type, target.type),
            };
        }

        // 4. Fuzzy name match with same or compatible type
        const fuzzyMatch = bestFuzzyMatch(target.name, sourceColumns, target.type);
        if (fuzzyMatch) {
            const lvl = fuzzyMatch.type === target.type
                ? 'compatible'
                : compatibilityLevel(fuzzyMatch.type, target.type);
            return {
                targetColumn: target.name,
                targetType: target.type,
                sourceColumn: fuzzyMatch.name,
                sourceType: fuzzyMatch.type,
                compatibility: lvl,
                notes: `Fuzzy name match ('${fuzzyMatch.name}' → '${target.name}')${lvl !== 'compatible' ? '; ' + coercionNote(fuzzyMatch.type, target.type) : ''}`,
            };
        }

        // 5. First compatible type regardless of name
        const typeMatch = sourceColumns.find(
            s => !systemCols.has(s.name) && areTypesCompatible(s.type, target.type)
        );
        if (typeMatch) {
            return {
                targetColumn: target.name,
                targetType: target.type,
                sourceColumn: typeMatch.name,
                sourceType: typeMatch.type,
                compatibility: compatibilityLevel(typeMatch.type, target.type),
                notes: `No name match; using first compatible source column '${typeMatch.name}'`,
            };
        }

        // 6. No match
        return {
            targetColumn: target.name,
            targetType: target.type,
            sourceColumn: null,
            sourceType: null,
            compatibility: 'none',
            notes: 'No compatible source column found',
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copies rows from sourceTable to targetTable, mapping values between columns
 * according to the provided columnMapping.
 *
 * @param sourceDbId       ID of the source database
 * @param sourceTableName  Name of the source table
 * @param rowIds           Array of row IDs to copy, or 'all' to copy every row
 * @param targetDbId       ID of the target database (may equal sourceDbId)
 * @param targetTableName  Name of the target table
 * @param columnMapping    Array of { sourceColumn, targetColumn } pairs.
 *                         Build this with buildColumnMapping() or supply manually.
 */
export function copyRows(
    sourceDbId: string,
    sourceTableName: string,
    rowIds: number[] | 'all',
    targetDbId: string,
    targetTableName: string,
    columnMapping: Array<{ sourceColumn: string; targetColumn: string }>
): CopyRowsResult {
    const { dbPath: srcDbPath, metaPath: srcMetaPath } = getDbPaths(sourceDbId);
    const { dbPath: tgtDbPath, metaPath: tgtMetaPath } = getDbPaths(targetDbId);

    if (!fs.existsSync(srcDbPath)) throw new Error(`Source database '${sourceDbId}' not found.`);
    if (!fs.existsSync(tgtDbPath)) throw new Error(`Target database '${targetDbId}' not found.`);
    if (!fs.existsSync(srcMetaPath)) throw new Error(`Metadata for '${sourceDbId}' not found.`);
    if (!fs.existsSync(tgtMetaPath)) throw new Error(`Metadata for '${targetDbId}' not found.`);

    const tgtMeta: DatabaseMetadata = JSON.parse(fs.readFileSync(tgtMetaPath, 'utf-8'));
    const tgtTableMeta = tgtMeta.tables?.[targetTableName];
    if (!tgtTableMeta) throw new Error(`Target table '${targetTableName}' not found.`);

    const sameDb = srcDbPath === tgtDbPath;
    const srcDb = new Database(srcDbPath);
    const tgtDb = sameDb ? srcDb : new Database(tgtDbPath);

    const result: CopyRowsResult = { copied: 0, skipped: 0, errors: [] };

    try {
        // Fetch source rows
        let sourceRows: Record<string, any>[];
        if (rowIds === 'all') {
            sourceRows = srcDb.prepare(`SELECT * FROM "${sourceTableName}"`).all() as Record<string, any>[];
        } else {
            const placeholders = rowIds.map(() => '?').join(', ');
            sourceRows = srcDb
                .prepare(`SELECT * FROM "${sourceTableName}" WHERE id IN (${placeholders})`)
                .all(...rowIds) as Record<string, any>[];
        }

        // Build insert statement for target
        const validMappings = columnMapping.filter(m => m.sourceColumn && m.targetColumn);
        const targetCols = ['title', 'content', 'date_created', 'date_modified', 'hidden'];
        for (const m of validMappings) {
            if (!targetCols.includes(m.targetColumn)) {
                targetCols.push(m.targetColumn);
            }
        }

        const insertCols = targetCols.filter(c => c !== 'id');
        const placeholders = insertCols.map(() => '?').join(', ');
        const insertStmt = tgtDb.prepare(
            `INSERT INTO "${targetTableName}" (${insertCols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
        );

        const tgtMappingLookup = new Map(validMappings.map(m => [m.targetColumn, m.sourceColumn]));

        const insertMany = tgtDb.transaction((rows: Record<string, any>[]) => {
            for (const row of rows) {
                try {
                    const now = Date.now();
                    const values = insertCols.map(col => {
                        if (col === 'date_created') return row.date_created ?? now;
                        if (col === 'date_modified') return now;
                        if (col === 'hidden') return 0;
                        const srcCol = tgtMappingLookup.get(col);
                        if (!srcCol) return null;
                        const srcVal = row[srcCol];
                        if (srcVal === undefined || srcVal === null) return null;
                        return coerceValue(srcVal, tgtTableMeta.columns[col]?.type ?? 'string');
                    });
                    insertStmt.run(...values);
                    result.copied++;
                } catch (err: any) {
                    result.skipped++;
                    result.errors.push(`Row id=${row.id}: ${err.message}`);
                }
            }
        });

        insertMany(sourceRows);
    } finally {
        srcDb.close();
        if (!sameDb) tgtDb.close();
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy column (definition + data)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copies a column's definition (from metadata) and its data to another table.
 *
 * If targetColumnName is omitted, the source column name is reused.
 * If overwrite is false (default), throws if the target column already exists.
 *
 * Data is coerced from the source type to the target type when they differ.
 * If types are incompatible, the column is still created but data is stored
 * as strings in the target (only safe if targetType is string / rich_text).
 */
export function copyColumn(
    sourceDbId: string,
    sourceTableName: string,
    sourceColumnName: string,
    targetDbId: string,
    targetTableName: string,
    targetColumnName?: string,
    options: { overwrite?: boolean } = {}
): void {
    const { overwrite = false } = options;
    const { dbPath: srcDbPath, metaPath: srcMetaPath } = getDbPaths(sourceDbId);
    const { dbPath: tgtDbPath, metaPath: tgtMetaPath } = getDbPaths(targetDbId);

    if (!fs.existsSync(srcDbPath)) throw new Error(`Source database '${sourceDbId}' not found.`);
    if (!fs.existsSync(tgtDbPath)) throw new Error(`Target database '${targetDbId}' not found.`);

    const srcMeta: DatabaseMetadata = JSON.parse(fs.readFileSync(srcMetaPath, 'utf-8'));
    const tgtMeta: DatabaseMetadata = JSON.parse(fs.readFileSync(tgtMetaPath, 'utf-8'));

    const srcColMeta = srcMeta.tables?.[sourceTableName]?.columns?.[sourceColumnName];
    if (!srcColMeta) throw new Error(`Source column '${sourceColumnName}' not found in '${sourceTableName}'.`);

    const finalTargetCol = normalizeName(targetColumnName ?? sourceColumnName);
    const tgtTableMeta = tgtMeta.tables?.[targetTableName];
    if (!tgtTableMeta) throw new Error(`Target table '${targetTableName}' not found.`);

    const existsInMeta = finalTargetCol in (tgtTableMeta.columns ?? {});
    if (existsInMeta && !overwrite) {
        throw new Error(`Column '${finalTargetCol}' already exists in '${targetTableName}'. Use overwrite:true to replace.`);
    }

    const sameDb = srcDbPath === tgtDbPath;
    const srcDb = new Database(srcDbPath);
    const tgtDb = sameDb ? srcDb : new Database(tgtDbPath);

    try {
        // 1. Add column to target table if it doesn't exist
        const targetSqlType = columnTypeMap[srcColMeta.type] ?? 'TEXT';
        if (!existsInMeta) {
            tgtDb.exec(`ALTER TABLE "${targetTableName}" ADD COLUMN "${finalTargetCol}" ${targetSqlType}`);
        }

        // 2. Copy data
        const sourceRows = srcDb
            .prepare(`SELECT id, "${sourceColumnName}" FROM "${sourceTableName}"`)
            .all() as Array<{ id: number; [key: string]: any }>;

        const updateStmt = tgtDb.prepare(
            `UPDATE "${targetTableName}" SET "${finalTargetCol}" = ? WHERE id = ?`
        );

        const updateMany = tgtDb.transaction(() => {
            for (const row of sourceRows) {
                const val = row[sourceColumnName];
                if (val === null || val === undefined) continue;
                const coerced = coerceValue(val, srcColMeta.type);
                updateStmt.run(coerced, row.id);
            }
        });

        updateMany();

        // 3. Update target metadata
        const colCount = Object.keys(tgtTableMeta.columns).length;
        tgtTableMeta.columns[finalTargetCol] = {
            ...srcColMeta,
            index: existsInMeta ? (tgtTableMeta.columns[finalTargetCol]?.index ?? colCount) : colCount,
        };
        tgtMeta.modifiedAt = new Date().toISOString();
        fs.writeFileSync(tgtMetaPath, JSON.stringify(tgtMeta, null, 2));
    } finally {
        srcDb.close();
        if (!sameDb) tgtDb.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces a value towards the target column type.
 * Lenient — prefers keeping data over throwing.
 */
function coerceValue(value: any, targetType: ColumnType): any {
    if (value === null || value === undefined) return null;

    switch (targetType) {
        case 'string':
        case 'rich_text':
        case 'custom':
            return String(value);

        case 'integer':
        case 'rating':
        case 'date': {
            const n = Number(value);
            if (isNaN(n)) return null;
            if (targetType === 'rating') return Math.max(0, Math.min(5, Math.trunc(n)));
            return Math.trunc(n);
        }

        case 'float':
        case 'advanced_rating': {
            const n = Number(value);
            if (isNaN(n)) return null;
            if (targetType === 'advanced_rating') return Math.max(0, Math.min(10, n));
            return n;
        }

        case 'boolean': {
            if (typeof value === 'boolean') return value ? 1 : 0;
            const n = Number(value);
            return isNaN(n) ? 0 : (n !== 0 ? 1 : 0);
        }

        case 'single_tag':
        case 'multi_tag':
        case 'link':
            return String(value);

        default:
            return String(value);
    }
}

/**
 * Finds the best matching source column for a target column name using
 * a simple Jaro-Winkler similarity threshold (≥ 0.85).
 * Only returns a match if the source type is compatible with the target type.
 */
function bestFuzzyMatch(
    targetName: string,
    sourceColumns: ColumnDef[],
    targetType: ColumnType
): ColumnDef | null {
    const systemCols = new Set(['id', 'hidden', 'date_created', 'date_modified']);
    let best: { col: ColumnDef; score: number } | null = null;

    for (const src of sourceColumns) {
        if (systemCols.has(src.name)) continue;
        if (src.name === targetName) continue; // exact handled elsewhere
        if (!areTypesCompatible(src.type, targetType) && targetType !== 'string') continue;

        const score = jaroWinkler(targetName, src.name);
        if (score >= 0.85 && (!best || score > best.score)) {
            best = { col: src, score };
        }
    }

    return best?.col ?? null;
}

/** Jaro-Winkler string similarity (0–1). */
function jaroWinkler(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0;

    const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDist);
        const end = Math.min(i + matchDist + 1, len2);
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // Winkler prefix bonus
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1[i] === s2[i]) prefix++; else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
}

function coercionNote(sourceType: ColumnType, targetType: ColumnType): string {
    const notes: Partial<Record<ColumnType, Partial<Record<ColumnType, string>>>> = {
        float:           { integer: 'Decimal part will be truncated.' },
        integer:         { boolean: 'Non-zero becomes 1, zero becomes 0.' },
        boolean:         { integer: '0 or 1.' },
        rating:          { integer: 'Value already 0–5.' },
        advanced_rating: { rating: 'Value clamped to 0–5 integer.' },
        string:          { integer: 'Non-numeric strings become null.', float: 'Non-numeric strings become null.', boolean: 'Non-0/1 strings become 0.' },
    };
    return notes[sourceType]?.[targetType] ?? `${sourceType} → ${targetType} coercion applied.`;
}
