export type ColumnType =
    | 'string'
    | 'integer'
    | 'float'
    | 'boolean'
    | 'rating'          // 0 to 5
    | 'advanced_rating' // float 0 to 10
    | 'date'            // unix timestamp
    | 'tags'            // comma- or space-separated
    | 'rich_text';      // markdown or similar

export interface ColumnDef {
    name: string;
    type: ColumnType;
}

export interface EntryRow {
    id: number;
    title: string;        // string
    content: string;      // rich_text
    date_created: number; // date
    date_updated: number; // date
    hidden: boolean;      // boolean
}
