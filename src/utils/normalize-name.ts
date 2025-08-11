export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '_');
}