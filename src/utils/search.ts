import lucene from 'lucene-query-parser';
import { ColumnDef } from '../types/types';

// Treat these column types as numeric for comparisons
const numericTypes = new Set<ColumnDef['type']>([
    'integer',
    'float',
    'rating',
    'advanced_rating',
    'date',
    'boolean', // treat boolean as 0/1 numeric equality
]);

function resolveFieldName(field: string, columns: ColumnDef[]): string | null {
    if (!field) return null;
    if (field.startsWith('i')) {
        const index = parseInt(field.slice(1), 10);
        const col = columns.find((c) => c.index === index);
        return col?.name || null;
    }
    const col = columns.find((c) => c.name.toLowerCase() === field.toLowerCase());
    return col?.name || null;
}

function getColType(columns: ColumnDef[], colName: string): ColumnDef['type'] {
    return columns.find((c) => c.name === colName)?.type || 'string';
}

function coerceBoolean(value: string): number | null {
    if (/^(true|1)$/i.test(value)) return 1;
    if (/^(false|0)$/i.test(value)) return 0;
    return null;
}

function isRegexNode(node: any): boolean {
    // Library uses "regexpr" (as seen in your logs). Also support "regex" just in case.
    if (node?.regexpr === true || node?.regex === true) return true;
    // Support /pattern/ literal syntax (if it ever comes through as term with slashes)
    if (typeof node?.term === 'string' && node.term.length >= 2 && node.term.startsWith('/') && node.term.endsWith('/')) {
        return true;
    }
    return false;
}

function extractRegexPattern(node: any): string {
    if (node?.regexpr === true || node?.regex === true) {
        return String(node.term); // raw pattern (no slashes)
    }
    const t = String(node.term || '');
    if (t.startsWith('/') && t.endsWith('/')) return t.slice(1, -1);
    return t;
}

function buildComparisonForNumeric(colName: string, rawTerm: string, params: any[]): string | null {
    const m = rawTerm.match(/^(>=|<=|>|<)(.+)$/);
    if (m) {
        const val = parseFloat(m[2]);
        params.push(val);
        return `${colName} ${m[1]} ?`;
    }
    if (!isNaN(Number(rawTerm))) {
        params.push(Number(rawTerm));
        return `${colName} = ?`;
    }
    return null;
}

function buildWhereFromNode(node: any, params: any[], columns: ColumnDef[]): string {
    if (!node) return '1';

    // Some ASTs wrap a term inside { left: <term> } with no operator/right
    if (node.left && !node.right && !node.operator && node.field == null && node.term == null) {
        return buildWhereFromNode(node.left, params, columns);
    }

    // Unary NOT operator form: { operator: 'NOT', right: ... } (sometimes left is used)
    if (typeof node.operator === 'string' && node.operator.toUpperCase() === 'NOT') {
        const child = node.right ?? node.left;
        if (!child) return '1';
        const childSQL = buildWhereFromNode(child, params, columns);
        return `(NOT ${childSQL})`;
    }

    // Node-level negation flag or '-' prefix (e.g., -hidden:1)
    if (node.not === true || node.prefix === '-') {
        const copy = { ...node };
        delete copy.not;
        if (copy.prefix === '-') copy.prefix = null;
        const inner = buildWhereFromNode(copy, params, columns);
        return `(NOT ${inner})`;
    }

    // Binary operators: AND / OR
    if (node.left && node.right && node.operator) {
        const leftSQL = buildWhereFromNode(node.left, params, columns);
        const rightSQL = buildWhereFromNode(node.right, params, columns);
        const op = String(node.operator).toUpperCase();
        return `(${leftSQL} ${op} ${rightSQL})`;
    }

    // Fielded term (e.g., title:alpha, i1:alpha, count:>5)
    if (node.field && node.term != null) {
        let colName = resolveFieldName(node.field, columns) || 'title';
        if (node.field === '<implicit>') colName = 'title';

        const colType = getColType(columns, colName);

        // Regex
        if (isRegexNode(node)) {
            const pattern = extractRegexPattern(node);
            params.push(pattern);
            return `${colName} REGEXP ?`;
        }

        // Numeric (including boolean treated as 0/1)
        if (numericTypes.has(colType)) {
            if (colType === 'boolean') {
                const boolVal = coerceBoolean(String(node.term));
                if (boolVal !== null) {
                    params.push(boolVal);
                    return `${colName} = ?`;
                }
                // fall through to numeric comparisons if term uses >/< (rare for boolean)
            }
            const numericSQL = buildComparisonForNumeric(colName, String(node.term), params);
            if (numericSQL) return numericSQL;
        }

        // Default LIKE
        params.push(`%${String(node.term)}%`);
        return `${colName} LIKE ? COLLATE NOCASE`;
    }

    // Bare term (implicit title search)
    if (node.term != null) {
        const colName = 'title';

        if (isRegexNode(node)) {
            const pattern = extractRegexPattern(node);
            params.push(pattern);
            return `${colName} REGEXP ?`;
        }

        // Default LIKE on title
        params.push(`%${String(node.term)}%`);
        return `${colName} LIKE ? COLLATE NOCASE`;
    }

    // Grouped terms (default AND)
    if (Array.isArray(node)) {
        const subClauses = node
            .map((n) => buildWhereFromNode(n, params, columns))
            .filter((clause) => clause && clause !== '1');
        if (subClauses.length === 0) return '1';
        return `(${subClauses.join(' AND ')})`;
    }

    return '1';
}

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

        // Normalize simple cases
        if (typeof parsed === 'string') {
            parsed = { term: parsed };
        }
        if (Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.term != null) {
            parsed = parsed[0];
        }

        console.log('NORMALIZED PARSED:', JSON.stringify(parsed, null, 2));
    } catch {
        console.log('Lucene parse failed, using fallback split.');
        const terms = queryString.split(/\s+/);
        const params: any[] = [];
        const where = terms
            .map((term) => {
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