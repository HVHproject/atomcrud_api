export type ColumnType =
    | 'string'
    | 'integer'
    | 'float'
    | 'boolean'
    | 'rating'          // 0 to 5
    | 'advanced_rating' // float 0 to 10
    | 'date'            // unix timestamp
    | 'multi_tag'       // multi-select list
    | 'single_tag'      // single-select list
    | 'rich_text'       // HTML string (TipTap)
    | 'link'            // display name + url object
    | 'custom';         // validated by regex in metadata

export interface ColumnDef {
    name: string;
    type: ColumnType;
    hidden?: boolean;
    index: number;
    tags?: TagDef[];       // for single_tag / multi_tag
    rule?: string;         // for custom
    visualization?: string; // front-end display hint (e.g. "progress", "color", "stars")
    tagLock?: boolean;     // for single_tag / multi_tag: prevents adding/removing tags when true
    linkedList?: string;   // for single_tag / multi_tag: ID of a GlobalTagList this column is bound to
}

export interface Column {
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: any;
    pk: number;
}

export interface TagDef {
    name: string;
    description: string;
}

/**
 * A GlobalTagList is a named, database-level list of string values that can be
 * shared across tag columns. It is synced from a source column on demand.
 *
 * Acceptable source column types: 'string', 'single_tag', 'multi_tag'
 *
 * - For single_tag / multi_tag: the registered tag names are copied into values[].
 * - For string: every unique non-null value found in the column's rows is stored.
 *
 * When a tag column's linkedList field is set to a GlobalTagList id:
 *   - tagLock is automatically set to true
 *   - The column's tags[] are replaced with the list's values[]
 *   - Tags cannot be added or removed until the column is unlinked
 */
export interface GlobalTagList {
    id: string;
    /** Human-readable name for the list */
    name: string;
    /** Table the list was sourced from */
    sourceTable: string;
    /** Column the list was sourced from */
    sourceColumn: string;
    /** Type of the source column */
    sourceType: 'string' | 'single_tag' | 'multi_tag';
    /** The actual list of string values */
    values: string[];
    /** ISO timestamp of last sync */
    lastSyncedAt: string;
}

export interface DatabaseMetadata {
    id: string;
    displayName: string;
    createdAt: string;
    modifiedAt: string;
    description?: string;
    hidden?: boolean;
    /**
     * Database-level shared tag lists.
     * Keyed by list ID (format: {tableName}_{columnName}_{timestamp}).
     */
    globalTagLists?: {
        [listId: string]: GlobalTagList;
    };
    tables?: {
        [tableName: string]: {
            hidden: boolean;
            columns: {
                [columnName: string]: {
                    type: ColumnType;
                    hidden?: boolean;
                    index: number;
                    tags?: TagDef[];
                    rule?: string;
                    visualization?: string;
                    tagLock?: boolean;
                    linkedList?: string;
                };
            };
        };
    };
}
