import lucene from 'lucene-query-parser';
import { ColumnDef } from '../types/types';

// Resolves a column identifier like "i3" or "title" to an actual column name.
function resolveFieldName(field: string, columns: ColumnDef[]): string | null {
    if (!field) return null;
    if (field.startsWith('i')) {
        const index = parseInt(field.slice(1), 10);
        const col = columns.find(c => c.index === index);
        return col?.name || null;
    }
    const col = columns.find(c => c.name.toLowerCase() === field.toLowerCase());
    return col?.name || null;
}

// Recursively builds a SQL WHERE clause and parameter list from a Lucene AST node.
function buildWhereFromNode(
    node: any,
    params: any[],
    columns: ColumnDef[]
): string {
    if (!node) return '1';

    // If this is a wrapper node with only a left side, unwrap it
    if (node.left && !node.right && !node.operator) {
        return buildWhereFromNode(node.left, params, columns);
    }

    // Handle compound expressions (AND, OR, NOT)
    if (node.left && node.right && node.operator) {
        const leftSQL = buildWhereFromNode(node.left, params, columns);
        const rightSQL = buildWhereFromNode(node.right, params, columns);
        const op = node.operator.toUpperCase();
        return `(${leftSQL} ${op} ${rightSQL})`;
    }

    // Handle NOT
    if (node.operator && node.operator.toUpperCase() === 'NOT' && node.right) {
        const rightSQL = buildWhereFromNode(node.right, params, columns);
        return `(NOT ${rightSQL})`;
    }

    // Handle single term with explicit field
    if (node.field && node.term) {
        let colName = resolveFieldName(node.field, columns) || 'title';
        if (node.field === '<implicit>') colName = 'title'; // default for bare terms
        if (node.term.startsWith('/') && node.term.endsWith('/')) {
            const pattern = node.term.slice(1, -1);
            params.push(pattern);
            return `${colName} REGEXP ?`;
        } else {
            params.push(`%${node.term}%`);
            return `${colName} LIKE ? COLLATE NOCASE`;
        }
    }

    // Handle bare term
    if (node.term) {
        const colName = 'title';
        if (node.term.startsWith('/') && node.term.endsWith('/')) {
            const pattern = node.term.slice(1, -1);
            params.push(pattern);
            return `${colName} REGEXP ?`;
        } else {
            params.push(`%${node.term}%`);
            return `${colName} LIKE ? COLLATE NOCASE`;
        }
    }

    // Handle grouped terms
    if (Array.isArray(node)) {
        const subClauses = node
            .map(n => buildWhereFromNode(n, params, columns))
            .filter(clause => clause && clause !== '1');
        if (subClauses.length === 0) return '1';
        return `(${subClauses.join(' AND ')})`; // default AND
    }

    return '1';
}

// Converts a Lucene-like query string into a SQL WHERE clause and params.
export function parseSearchQuery(
    queryString: string,
    columns: ColumnDef[]
): { where: string; params: any[] } {
    if (!queryString || !queryString.trim()) {
        return { where: '1', params: [] };
    }

    let parsed: any;
    try {
        parsed = lucene.parse(queryString);

        console.log('RAW PARSED:', JSON.stringify(parsed, null, 2));

        // Normalize single term or single-element array
        if (typeof parsed === 'string') {
            parsed = { term: parsed };
        }
        if (Array.isArray(parsed) && parsed.length === 1 && parsed[0].term) {
            parsed = parsed[0];
        }

        console.log('NORMALIZED PARSED:', JSON.stringify(parsed, null, 2));
    } catch {
        console.log('Lucene parse failed, using fallback split.');
        const terms = queryString.split(/\s+/);
        const params: any[] = [];
        const where = terms
            .map(term => {
                params.push(`%${term}%`);
                return `title LIKE ? COLLATE NOCASE`;
            })
            .join(' AND ');
        return { where, params };
    }

    const params: any[] = [];
    const where = buildWhereFromNode(parsed, params, columns);

    console.log('FINAL WHERE:', where);
    console.log('FINAL PARAMS:', params);

    return { where, params };
}