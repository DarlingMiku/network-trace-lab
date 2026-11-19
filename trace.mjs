export const phases = [
  ['queue', 'Queue'],
  ['dns', 'DNS'],
  ['connect', 'Connect'],
  ['tls', 'TLS'],
  ['send', 'Send'],
  ['wait', 'Wait'],
  ['receive', 'Receive'],
  ['other', 'Unattributed'],
]

const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function readTimings(entry) {
  const timings = entry.timings ?? {}
  const connect = nonnegative(timings.connect)
  const ssl = nonnegative(timings.ssl)
  const tls = connect === null || ssl === null ? null : Math.min(connect, ssl)
  const values = {
    queue: nonnegative(timings.blocked),
    dns: nonnegative(timings.dns),
    connect: connect === null ? null : connect - (tls ?? 0),
    tls,
    send: nonnegative(timings.send),
    wait: nonnegative(timings.wait),
    receive: nonnegative(timings.receive),
  }
  const known = Object.values(values).filter(value => value !== null)
  const measured = known.reduce((sum, value) => sum + value, 0)
  const reported = nonnegative(entry.time)
  const duration = reported ?? (known.length ? measured : null)
  const scale = duration !== null && measured > duration ? duration / measured : 1
  values.other = duration === null ? null : Math.max(0, duration - measured)
  return {
    duration,
    timings: values,
    segments: phases.flatMap(([key]) => values[key] > 0
      ? [{ key, duration: key === 'other' ? values[key] : values[key] * scale }]
      : []),
  }
}

function transferSize(response) {
  const actual = nonnegative(response?._transferSize)
  if (actual !== null) return actual
  const headers = nonnegative(response?.headersSize)
  const body = nonnegative(response?.bodySize)
  return headers === null || body === null ? null : headers + body
}

function readEntry(entry, id) {
  const started = typeof entry?.startedDateTime === 'string' ? Date.parse(entry.startedDateTime) : NaN
  if (!Number.isFinite(started) || typeof entry?.request?.url !== 'string') return null
  let url
  try {
    url = new URL(entry.request.url)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname || '/'
  const method = typeof entry.request.method === 'string' ? entry.request.method.slice(0, 20) : '—'
  const type = typeof entry._resourceType === 'string' ? entry._resourceType.slice(0, 40) : null
  const mime = typeof entry.response?.content?.mimeType === 'string'
    ? entry.response.content.mimeType.split(';')[0].trim().slice(0, 100)
    : null
  return {
    id, started, host: url.host, path, method, type, mime,
    status: nonnegative(entry.response?.status),
    bytes: transferSize(entry.response),
    ...readTimings(entry),
  }
}

export function readHar(har) {
  if (!Array.isArray(har?.log?.entries)) {
    throw new Error('This file needs a HAR log with an entries array.')
  }
  const rows = har.log.entries.map(readEntry).filter(Boolean).sort((a, b) => a.started - b.started)
  const origin = rows[0]?.started ?? 0
  for (const row of rows) row.offset = row.started - origin
  return { rows, skipped: har.log.entries.length - rows.length, summary: summarize(rows) }
}

export function summarize(rows) {
  let spanMs = null
  let httpErrors = 0
  let unknownStatus = 0
  let transferredBytes = 0
  let transfersMeasured = 0
  const durations = []
  for (const row of rows) {
    if (row.duration !== null) {
      durations.push(row.duration)
      spanMs = Math.max(spanMs ?? 0, row.offset + row.duration)
    }
    if (row.status === null || row.status === 0) unknownStatus++
    else if (row.status >= 400) httpErrors++
    if (row.bytes !== null) {
      transferredBytes += row.bytes
      transfersMeasured++
    }
  }
  durations.sort((a, b) => a - b)
  return {
    requests: rows.length,
    spanMs,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1] ?? null,
    durationsMeasured: durations.length,
    httpErrors,
    unknownStatus,
    transferredBytes: transfersMeasured ? transferredBytes : null,
    transfersMeasured,
  }
}

export function selectRows(rows, filters) {
  const query = filters.query.trim().toLowerCase()
  const selected = rows.filter(row => {
    if (filters.host && row.host !== filters.host) return false
    if (filters.status === 'error' && (row.status === null || row.status < 400)) return false
    if (filters.status === 'redirect' && (row.status === null || row.status < 300 || row.status >= 400)) return false
    if (filters.status === 'unknown' && row.status !== null && row.status !== 0) return false
    return !query || (row.host + row.path + ' ' + row.method + ' ' + (row.type ?? '')).toLowerCase().includes(query)
  })
  const key = filters.order === 'duration' ? 'duration' : filters.order === 'bytes' ? 'bytes' : null
  if (key) selected.sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))
  return selected
}

export function demoHar() {
  const demo = [
    [0, '/', 'shop.example', 'document', 200, 18, 19, 94, 191, 71, 26540],
    [375, '/assets/app.css', 'cdn.shop.example', 'stylesheet', 200, 8, 17, 74, 78, 88, 59382],
    [393, '/assets/app.js', 'cdn.shop.example', 'script', 200, 13, -1, -1, 83, 223, 204120],
    [420, '/assets/brand.woff2', 'cdn.shop.example', 'font', 200, 1, -1, -1, 127, 51, 25340],
    [433, '/images/hero.webp', 'cdn.shop.example', 'image', 200, 5, -1, -1, 110, 525, 341329],
    [540, '/api/catalog', 'shop.example', 'fetch', 200, 24, -1, -1, 1239, 177, 46892],
    [621, '/api/session', 'shop.example', 'fetch', 200, 17, -1, -1, 228, 20, 4031],
    [658, '/assets/checkout.js', 'cdn.shop.example', 'script', 200, 93, -1, -1, 123, 88, 91323],
    [830, '/api/cart', 'shop.example', 'fetch', 200, 8, -1, -1, 353, 42, 11383],
    [910, '/images/pack.webp', 'cdn.shop.example', 'image', 200, 6, -1, -1, 44, 352, 218139],
    [1120, '/api/recommendations', 'shop.example', 'fetch', 503, 19, -1, -1, 462, 27, 930],
    [1207, '/assets/icons.svg', 'cdn.shop.example', 'image', 200, 0, -1, -1, 3, 3, 0],
    [1240, '/images/detail.webp', 'cdn.shop.example', 'image', 200, 28, -1, -1, 132, 367, 155810],
    [1554, '/api/inventory', 'shop.example', 'fetch', 200, 16, -1, -1, 253, 72, 7659],
    [2020, '/api/shipping', 'shop.example', 'fetch', 200, 11, -1, -1, 528, 64, 6103],
    [2380, '/api/metrics', 'shop.example', 'fetch', 204, 2, -1, -1, 144, 0, 218],
  ]
  const epoch = Date.parse('2026-01-01T12:00:00Z')
  const entries = demo.map(([offset, path, host, type, status, blocked, dns, connect, wait, receive, bytes]) => {
    const timings = { blocked, dns, connect, ssl: connect < 0 ? -1 : Math.round(connect * 0.6), send: 2, wait, receive }
    return {
      startedDateTime: new Date(epoch + offset).toISOString(),
      time: blocked + Math.max(0, dns) + Math.max(0, connect) + timings.send + wait + receive,
      request: { method: 'GET', url: 'https://' + host + path },
      response: { status, _transferSize: bytes },
      timings,
      _resourceType: type,
    }
  })
  return { log: { version: '1.2', creator: { name: 'Network Trace Lab demo', version: '1' }, entries } }
}
