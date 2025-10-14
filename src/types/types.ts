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
    | 'rich_text'       // markdown or similar
    | 'link'            // display name + url object
    | 'custom';         // validated by regex in metadata

export interface ColumnDef {
    name: string;
    type: ColumnType;
    hidden?: boolean;
    index: number;
    tags?: TagDef[]; // for single_tag / multi_tag
    rule?: string;   // for custom
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
                };
            };
        };
    };
}