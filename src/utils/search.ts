import lucene from 'lucene-query-parser';
import { ColumnDef } from '../types/types';

// Treat these column types as numeric for comparisons
const numericTypes = new Set<ColumnDef['type']>([
    'integer',
    'float',
    'rating',
    'advanced_rating',
    'date',
    'boolean',
]);

export function resolveFieldName(field: string, columns: ColumnDef[]): string | null {
    if (!field) return null;
    if (/^i\d+$/.test(field)) {
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
    if (node?.regexpr === true || node?.regex === true) return true;
    if (typeof node?.term === 'string' && node.term.length >= 2 && node.term.startsWith('/') && node.term.endsWith('/')) {
        return true;
    }
    return false;
}

function extractRegexPattern(node: any): string {
    if (node?.regexpr === true || node?.regex === true) {
        return String(node.term);
    }
    const t = String(node.term || '');
    if (t.startsWith('/') && t.endsWith('/')) return t.slice(1, -1);
    return t;
}

function buildComparisonForNumeric(
    colName: string,
    colType: ColumnDef['type'],
    rawTerm: string,
    params: any[]
): string | null {
    const isDateLike = /^\s*\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*$/.test(rawTerm)
        || /^\s*(>=|<=|>|<)\s*\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s*$/.test(rawTerm);

    function parseDateToTimestamp(dateStr: string): number | null {
        const clean = dateStr.trim().replace(/-/g, '/');
        const d = new Date(clean);
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    if (colType === 'date' && isDateLike) {
        const m = rawTerm.match(/^(>=|<=|>|<)\s*(.+)$/);
        if (m) {
            const op = m[1];
            const date = parseDateToTimestamp(m[2]);
            if (date == null) return null;

            const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

            let value;
            if (op === '>') value = dayEnd.getTime();
            if (op === '>=') value = dayStart.getTime();
            if (op === '<') value = dayStart.getTime();
            if (op === '<=') value = dayEnd.getTime();

            params.push(value);
            return `${colName} ${op} ?`;
        }

        const exact = parseDateToTimestamp(rawTerm);
        if (exact != null) {
            const dayStart = new Date(exact); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(exact); dayEnd.setHours(23, 59, 59, 999);

            params.push(dayStart.getTime(), dayEnd.getTime());
            return `${colName} BETWEEN ? AND ?`;
        }

        return null;
    }

    const numericCol = (['integer', 'float', 'rating', 'advanced_rating', 'date', 'boolean', 'custom'].includes(colType))
        ? `CAST(${colName} AS REAL)`
        : colName;

    const m = rawTerm.match(/^(>=|<=|>|<)\s*(.+)$/);
    if (m) {
        const val = parseFloat(m[2]);
        if (isNaN(val)) return null;
        params.push(val);
        return `${numericCol} ${m[1]} ?`;
    }

    if (!isNaN(Number(rawTerm))) {
        params.push(Number(rawTerm));
        return `${numericCol} = ?`;
    }

    return null;
}

function buildWhereFromNode(node: any, params: any[], columns: ColumnDef[]): string {
    if (!node) return '1';

    // Some ASTs wrap a term inside { left: <term> } with no operator/right
    if (node.left && !node.right && !node.operator && node.field == null && node.term == null) {
        return buildWhereFromNode(node.left, params, columns);
    }

    // Handle NOT via prefix (!term) or !field
    let negate = false;
    if (node.prefix === '!') {
        negate = true;
        node = { ...node, prefix: null };
    }
    if (typeof node.field === 'string' && node.field.startsWith('!')) {
        negate = true;
        node = { ...node, field: node.field.slice(1) };
    }

    // Binary operators: AND / OR
    if (node.left && node.right && node.operator) {
        const leftSQL = buildWhereFromNode(node.left, params, columns);
        const rightSQL = buildWhereFromNode(node.right, params, columns);
        const op = String(node.operator).toUpperCase();
        return `(${leftSQL} ${op} ${rightSQL})`;
    }

    // Fielded term
    if (node.field && node.term != null) {
        let colName = resolveFieldName(node.field, columns) || 'title';
        if (node.field === '<implicit>') colName = 'title';

        const colType = getColType(columns, colName);
        const termStr = String(node.term);
        const wantsNumeric = /^[><]=?|^=/.test(termStr);

        // Regex
        if (isRegexNode(node)) {
            const pattern = extractRegexPattern(node);
            params.push(pattern);
            return negate
                ? `(NOT ${colName} REGEXP ?)`
                : `${colName} REGEXP ?`;
        }

        // Numeric (including boolean treated as 0/1)
        if (numericTypes.has(colType) || (colType === 'custom' && wantsNumeric)) {
            if (colType === 'boolean') {
                const boolVal = coerceBoolean(String(node.term));
                if (boolVal !== null) {
                    params.push(boolVal);
                    return negate
                        ? `(NOT ${colName} = ?)`
                        : `${colName} = ?`;
                }
            }
            const numericSQL = buildComparisonForNumeric(colName, colType, String(node.term), params);
            if (numericSQL) {
                return negate
                    ? `(NOT ${numericSQL})`
                    : numericSQL;
            }
        }

        // Default LIKE
        params.push(`%${termStr}%`);
        return negate
            ? `(NOT ${colName} LIKE ? COLLATE NOCASE)`
            : `${colName} LIKE ? COLLATE NOCASE`;
    }

    // Bare term (implicit title search)
    if (node.term != null) {
        const colName = 'title';

        if (isRegexNode(node)) {
            const pattern = extractRegexPattern(node);
            params.push(pattern);
            return negate
                ? `(NOT ${colName} REGEXP ?)`
                : `${colName} REGEXP ?`;
        }

        params.push(`%${String(node.term)}%`);
        return negate
            ? `(NOT ${colName} LIKE ? COLLATE NOCASE)`
            : `${colName} LIKE ? COLLATE NOCASE`;
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

export function parseSearchQuery(queryString: string, columns: ColumnDef[]) {
    if (!queryString || !queryString.trim()) {
        return { where: '1', params: [] };
    }

    // Replace & and | with AND and OR before parsing
    queryString = queryString
        .replace(/\band\b/gi, 'AND')
        .replace(/\bor\b/gi, 'OR');

    let parsed: any;
    try {
        parsed = lucene.parse(queryString);

        if (typeof parsed === 'string') {
            parsed = { term: parsed };
        }
        if (Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.term != null) {
            parsed = parsed[0];
        }
    } catch {
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

    return { where, params };
}