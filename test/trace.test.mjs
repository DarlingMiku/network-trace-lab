import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { demoHar, readHar, selectRows } from '../trace.mjs'

function entry(url = 'https://example.test/resource') {
  return {
    startedDateTime: '2026-01-01T12:00:00Z',
    request: { url, method: 'GET' },
    response: { status: 200, headersSize: 20, bodySize: 80 },
    time: 100,
    timings: { blocked: -1, dns: 5, connect: 30, ssl: 20, send: 1, wait: 60, receive: 4 },
  }
}

test('splits TLS from connect and removes URL credentials and query data', () => {
  const trace = readHar({ log: { entries: [entry('https://user:pass@example.test/resource?token=hidden#ref')] } })
  const item = trace.rows[0]
  assert.equal(item.path, '/resource')
  assert.equal(item.host, 'example.test')
  assert.equal(item.timings.connect, 10)
  assert.equal(item.timings.tls, 20)
  assert.equal(item.timings.queue, null)
  assert.equal(item.segments.reduce((sum, phase) => sum + phase.duration, 0), 100)
  assert.equal(trace.summary.spanMs, 100)
  assert.equal(trace.summary.transferredBytes, 100)
  assert.doesNotMatch(JSON.stringify(trace.summary), /example\.test|resource|hidden/)
})

test('uses reported duration, fills unattributed time, and prefers measured transfer including zero', () => {
  const known = {
    ...entry(), time: 120,
    response: { status: 304, headersSize: 30, bodySize: 900, _transferSize: 0 },
  }
  const without = { ...entry(), time: -1, timings: {}, response: { status: 0, headersSize: -1, bodySize: 24 } }
  const trace = readHar({ log: { entries: [known, without] } })
  assert.equal(trace.rows[0].timings.other, 20)
  assert.equal(trace.rows[0].bytes, 0)
  assert.equal(trace.rows[1].duration, null)
  assert.equal(trace.rows[1].bytes, null)
  assert.equal(trace.summary.transfersMeasured, 1)
  assert.equal(trace.summary.unknownStatus, 1)
})

test('keeps the timeline relative to the earliest start and scales inconsistent segments', () => {
  const early = entry()
  const late = { ...entry(), time: 90, startedDateTime: '2026-01-01T12:00:01Z' }
  const trace = readHar({ log: { entries: [late, {}, early, entry('file:///private.txt')] } })
  assert.deepEqual(trace.rows.map(row => row.offset), [0, 1000])
  assert.equal(trace.summary.spanMs, 1090)
  assert.equal(trace.skipped, 2)
  const total = trace.rows[1].segments.reduce((sum, phase) => sum + phase.duration, 0)
  assert.ok(Math.abs(total - 90) < 0.000001)
})

test('sorts and filters the demo and accepts an empty HAR', () => {
  const trace = readHar(demoHar())
  assert.equal(trace.summary.requests, 16)
  const initial = { query: '', host: '', status: '', order: 'start' }
  const errors = selectRows(trace.rows, { ...initial, status: 'error' })
  assert.deepEqual(errors.map(row => row.status), [503])
  assert.equal(selectRows(trace.rows, { ...initial, order: 'duration' })[0].path, '/api/catalog')
  assert.equal(selectRows(trace.rows, { ...initial, query: 'CART' })[0].path, '/api/cart')
  assert.equal(readHar({ log: { entries: [] } }).summary.requests, 0)
  assert.throws(() => readHar({ entries: [] }), /HAR log/)
})
