import Long from 'long'

export function steamLong(value: string | number | bigint | Long): Long {
  if (Long.isLong(value)) return value
  if (typeof value === 'bigint') return Long.fromString(value.toString(), true)
  if (typeof value === 'string') return Long.fromString(value, true)
  return Long.fromNumber(value, true)
}

export function longToString(value: string | number | bigint | Long): string {
  if (Long.isLong(value)) return value.toString()
  return String(value)
}

