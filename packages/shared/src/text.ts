/**
 * JSON with object keys sorted, so two values with the same content always serialise the
 * same way. Needed wherever stored content is compared: PostgreSQL JSONB does not preserve
 * key order, so a plain JSON.stringify comparison reports identical content as different.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** Deep equality of JSON content, ignoring key order. */
export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** URL-safe slug: lowercase, ASCII, hyphen separated. */
export function slugify(input: string, maxLength = 96): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** camelCase identifier suitable for a field apiId. */
export function toFieldApiId(input: string): string {
  const words = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const id = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return /^[a-z]/.test(id) ? id.slice(0, 63) : `f${id}`.slice(0, 63);
}

export function toPascalCase(input: string): string {
  const out = input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(out) ? out : `T${out}`;
}

const IRREGULAR: Record<string, string> = { person: 'people', child: 'children', man: 'men', woman: 'women', category: 'categories' };

export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return word.slice(0, 1) + IRREGULAR[lower].slice(1);
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}
