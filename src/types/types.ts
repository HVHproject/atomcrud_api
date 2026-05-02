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
    | 'custom'          // validated by regex in metadata
    | 'table_ref'       // foreign key to one row in another table (stored as INTEGER row id)
    | 'table_ref_many'; // foreign keys to multiple rows in another table (stored as JSON array of ints)

export interface ColumnDef {
    name: string;
    type: ColumnType;
    hidden?: boolean;
    index: number;
    tags?: TagDef[];       // for single_tag / multi_tag
    rule?: string;         // for custom
    visualization?: string; // front-end display hint / display column name for table_ref
    tagLock?: boolean;     // for single_tag / multi_tag: prevents adding/removing tags when true
    linkedTable?: string;  // for table_ref / table_ref_many: target table name within this database
    required?: 'yes' | 'soft yes' | 'no';
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

export interface DatabaseMetadata {
    id: string;
    displayName: string;
    createdAt: string;
    modifiedAt: string;
    description?: string;
    hidden?: boolean;
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
                    linkedTable?: string;
                    required?: 'yes' | 'soft yes' | 'no';
                };
            };
        };
    };
}
