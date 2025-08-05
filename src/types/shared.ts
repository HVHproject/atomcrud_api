export interface ColumnDef {
    name: string;
    type: string;
}

export interface EntryRow {
    id: number;
    title: string;
    content: string;
    date_created: number;
    date_updated: number;
    hidden: boolean;
}
