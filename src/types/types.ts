export interface Column {
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: any;
    pk: number;
}

export interface DatabaseMetadata {
    id: string; // unique file-safe id, e.g., poems_1
    displayName: string;
    createdAt: string;
    modifiedAt: string;
    description?: string;
    tags?: string[];
    hidden?: boolean;
}
