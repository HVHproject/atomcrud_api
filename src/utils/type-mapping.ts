export const columnTypeMap: Record<string, string> = {
    string: 'TEXT',
    boolean: 'INTEGER',
    integer: 'INTEGER',
    float: 'REAL',
    date: 'INTEGER', // Unix timestamp
    rating: 'INTEGER', // 0–5
    advanced_rating: 'REAL', // 0.0–10.0
    tags: 'TEXT', // comma-separated
    rich_text: 'TEXT',
};
