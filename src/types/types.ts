export type ColumnType =
    | 'string'
    | 'integer'
    | 'float'
    | 'boolean'
    | 'rating'          // 0 to 5
    | 'advanced_rating' // float 0 to 10
    | 'date'            // unix timestamp
    | 'tags'            // comma- or space-separated
    | 'rich_text'       // markdown or similar
    | 'link';           // display name + url object

export interface ColumnDef {
    name: string;
    type: ColumnType;
    hidden?: boolean;
}

export interface Column {
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: any;
    pk: number;
}

export interface DatabaseMetadata {
    id: string;
    displayName: string;
    createdAt: string;
    modifiedAt: string;
    description?: string;
    tags?: string[];
    hidden?: boolean;
    tables?: {
        [tableName: string]: {
            hidden: boolean;
            columns: {
                [columnName: string]: {
                    type: ColumnType;
                    hidden?: boolean;
                };
            };
        };
    };
}