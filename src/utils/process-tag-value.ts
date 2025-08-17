import { ColumnDef } from "../types/types";
import { normalizeName } from "./normalize-name";

export function processTagValue(colMeta: ColumnDef, rawValue: any): string {
    if (typeof rawValue !== "string") {
        throw new Error(`Tags for column '${colMeta.name}' must be provided as a space-separated string`);
    }

    // Step 1: split by whitespace
    const inputTags = rawValue.trim() === "" ? [] : rawValue.split(/\s+/);

    // Step 2: normalize
    const normalized = inputTags.map(t => normalizeName(t)).filter(Boolean);

    // Step 3: enforce allowed tags
    const allowed = (colMeta.tags ?? []).map(t => t.name);
    for (const tag of normalized) {
        if (!allowed.includes(tag)) {
            throw new Error(`Tag '${tag}' is not registered in column '${colMeta.name}'`);
        }
    }

    // Step 4: dedupe + sort
    const uniqueSorted = Array.from(new Set(normalized)).sort();

    // Step 5: rejoin
    return uniqueSorted.join(" ");
}
