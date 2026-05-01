/**
 * Lowercase, trim, collapse whitespace and punctuation. Used to
 * compute `normalized_name` columns so "Chicken Breast", "chicken
 * breast", and "Chicken  breast." all collide on the same key.
 */
export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
