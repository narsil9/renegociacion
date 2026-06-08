/**
 * Date helper utilities for Chile local time (America/Santiago).
 */

/**
 * Returns the current date in Chile local time (at 00:00:00).
 */
export function getCurrentChileDate(): Date {
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(new Date());
  const day = parts.find(p => p.type === 'day')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const year = parts.find(p => p.type === 'year')?.value;

  if (!day || !month || !year) {
    // Fallback if formatting parts fails
    return new Date();
  }

  // Set the time to exactly midnight local time
  return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
}

/**
 * Parses a date string in DD/MM/YYYY or YYYY-MM-DD format into a Date object.
 */
export function parseDateString(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // DD/MM/YYYY or DD-MM-YYYY
  const dm = dateStr.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10) - 1;
    const year = parseInt(dm[3], 10);
    return new Date(year, month, day);
  }

  // YYYY-MM-DD
  const ymd = dateStr.match(/^(\d{4})[/\-](\d{2})[/\-](\d{2})$/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    return new Date(year, month, day);
  }

  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculates the difference in days between two Date objects (d1 - d2).
 */
export function getDaysDifference(d1: Date, d2: Date): number {
  const diffTime = d1.getTime() - d2.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}
