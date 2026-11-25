/**
 * Utilidades ligeras de exportación, sin dependencias pesadas.
 */

/** Reemplaza caracteres no permitidos en sistemas de archivos por guiones. */
export function escapeFilename(filename: string): string {
    return filename.replace(/[\\/:*?"<>|]/g, '-').trim();
}

/** Escapa un campo para CSV. */
export function escapeCsvField(field: string | number | undefined | null): string {
    if (field === null || field === undefined) return '';

    const stringValue = String(field);
    if (
        stringValue.includes('"') ||
        stringValue.includes(',') ||
        stringValue.includes('\n') ||
        stringValue.includes('\r')
    ) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
}
