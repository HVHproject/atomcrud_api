import { ColumnDef } from "../types/types";
import { normalizeName } from "./normalize-name";

export function processTagValue(colMeta: ColumnDef, rawValue: any): string {
    if (typeof rawValue !== "string") {
        throw new Error(`Tags for column '${colMeta.name}' must be provided as a space-separated string`);
    }

    const inputTags = rawValue.trim() === "" ? [] : rawValue.split(/\s+/);
    const normalized = inputTags.map(t => normalizeName(t)).filter(Boolean);

    const allowed = (colMeta.tags ?? []).map(t => t.name);
    for (const tag of normalized) {
        if (!allowed.includes(tag)) {
            throw new Error(`Tag '${tag}' is not registered in column '${colMeta.name}'`);
        }
    }

    if (colMeta.type === "single_tag") {
        if (normalized.length > 1) {
            throw new Error(`Column '${colMeta.name}' accepts only one tag`);
        }
        return normalized[0] ?? "";
    }

    // multi_tag
    const uniqueSorted = Array.from(new Set(normalized)).sort();
    return uniqueSorted.join(" ");
}
