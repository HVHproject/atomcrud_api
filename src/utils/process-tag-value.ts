import { ColumnDef } from "../types/types";
import { normalizeName } from "./normalize-name";

export function processTagValue(colMeta: ColumnDef, rawValue: any): string {
    if (!Array.isArray(rawValue) && typeof rawValue !== 'string') {
        throw new Error(`Tags for column '${colMeta.name}' must be an array or space-separated string`);
    }

    // Convert to array
    const inputTags = Array.isArray(rawValue)
        ? rawValue.map(t => String(t))
        : String(rawValue).split(/\s+/);

    const normalizedTags = inputTags
        .map(t => normalizeName(t))
        .filter(Boolean);

    // Get allowed tags from metadata
    const allowedTags = (colMeta.tags ?? []).map(t => t.name);

    // Ensure all are allowed
    for (const tag of normalizedTags) {
        if (!allowedTags.includes(tag)) {
            throw new Error(`Tag '${tag}' is not registered in column '${colMeta.name}'`);
        }
    }

    // Sort alphabetically and join with spaces
    return normalizedTags.sort().join(' ');
}
