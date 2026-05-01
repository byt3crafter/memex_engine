/**
 * Single source of "now" for the domain. Tests can stub via clock
 * factory; routes and services only call nowIso() / nowDate().
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function nowIso(clock: Clock = systemClock): string {
  return clock().toISOString();
}

export function isoDaysAgo(days: number, clock: Clock = systemClock): string {
  const d = clock();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function isoDateOnly(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toISOString().slice(0, 10);
}
