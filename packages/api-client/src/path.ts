/**
 * Build a request path, percent-encoding each interpolated value so an id cannot add
 * segments, a query or a fragment. `.` and `..` are rejected: `encodeURIComponent` leaves
 * dots alone and the URL parser collapses them into the parent path.
 */
export function path(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]
  values.forEach((value, i) => {
    const segment = String(value)
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TypeError(`Invalid path segment ${JSON.stringify(segment)}`)
    }
    out += encodeURIComponent(segment) + strings[i + 1]
  })
  return out
}
