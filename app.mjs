import { demoHar, phases, readHar, selectRows } from './trace.mjs'

const get = id => document.getElementById(id)
const pageSize = 60
const numbers = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
let trace
let picked = null
let page = 0
let importId = 0

function el(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}

function ms(value) {
  if (value === null) return '—'
  return value >= 1000 ? numbers.format(value / 1000) + ' s' : numbers.format(value) + ' ms'
}

function size(value) {
  if (value === null) return '—'
  if (value < 1024) return integer.format(value) + ' B'
  if (value < 1024 ** 2) return numbers.format(value / 1024) + ' KiB'
  return numbers.format(value / 1024 ** 2) + ' MiB'
}

function statusLabel(value) {
  const node = el('span', value || '—', 'http-status')
  node.dataset.type = !value ? 'unknown' : value >= 400 ? 'error' : value >= 300 ? 'redirect' : 'ok'
  return node
}

function setNotice(text = '', error = false) {
  get('notice').textContent = text
  get('notice').dataset.error = String(error)
}

function addMetric(container, title, value, caption) {
  const metric = el('div', undefined, 'metric')
  const valueCell = el('dd', value)
  const help = el('small', caption)
  const label = el('dt', title)
  valueCell.append(help)
  metric.append(label, valueCell)
  container.append(metric)
}

function drawMetrics() {
  const summary = trace.summary
  const metrics = get('metrics')
  metrics.replaceChildren()
  const errors = summary.httpErrors + ' HTTP ' + (summary.httpErrors === 1 ? 'error' : 'errors')
  addMetric(metrics, 'Requests', integer.format(summary.requests), errors)
  addMetric(metrics, 'Trace span', ms(summary.spanMs), 'First start to last measured finish')
  addMetric(metrics, 'P95 duration', ms(summary.p95Ms), 'Across ' + integer.format(summary.durationsMeasured) + ' measured requests')
  addMetric(metrics, 'Measured transfer', size(summary.transferredBytes), integer.format(summary.transfersMeasured) + ' of ' + integer.format(summary.requests) + ' requests')
}

function drawAxis() {
  const axis = get('axis')
  axis.replaceChildren()
  for (let step = 0; step <= 4; step++) {
    const tick = el('span', ms((trace.summary.spanMs ?? 0) * step / 4))
    tick.style.left = step * 25 + '%'
    axis.append(tick)
  }
}

function appendSegments(track, row) {
  for (const segment of row.segments) {
    const element = el('span', undefined, 'segment phase-' + segment.key)
    element.style.flexGrow = segment.duration
    track.append(element)
  }
}

function makeRow(row) {
  const tr = el('tr')
  tr.dataset.id = row.id
  tr.dataset.selected = String(row.id === picked?.id)
  const request = el('td')
  const button = el('button', undefined, 'request-button')
  button.type = 'button'
  button.setAttribute('aria-pressed', tr.dataset.selected)
  button.title = row.method + ' ' + row.host + row.path
  button.append(el('span', row.path, 'request-path'), el('span', row.method + ' · ' + (row.type || row.host), 'request-meta'))
  request.append(button)

  const code = el('td')
  code.append(statusLabel(row.status))
  const timeline = el('td')
  const waterfall = el('div', undefined, 'waterfall')
  const bar = el('div', undefined, 'bar')
  const scale = Math.max(1, trace.summary.spanMs ?? 0)
  bar.style.left = Math.min(100, row.offset / scale * 100) + '%'
  bar.style.width = (row.duration ?? 0) / scale * 100 + '%'
  bar.title = ms(row.offset) + ' after start · ' + ms(row.duration)
  appendSegments(bar, row)
  waterfall.append(bar)
  timeline.append(waterfall)
  tr.append(request, code, timeline, el('td', ms(row.duration), 'numeric'))
  return tr
}

function detailPair(container, label, value) {
  const pair = el('div')
  pair.append(el('dt', label), el('dd', value))
  container.append(pair)
}

function drawDetails() {
  const details = get('details')
  const status = get('detail-status')
  details.replaceChildren()
  status.replaceChildren()
  if (!picked) {
    details.append(el('p', 'Select a visible request to inspect its timings.', 'detail-host'))
    return
  }
  status.append(statusLabel(picked.status))
  details.append(el('p', picked.method + ' ' + picked.path, 'detail-name'), el('p', picked.host, 'detail-host'))
  const metadata = el('dl', undefined, 'detail-metadata')
  detailPair(metadata, 'Start offset', ms(picked.offset))
  detailPair(metadata, 'Duration', ms(picked.duration))
  detailPair(metadata, 'Transfer', size(picked.bytes))
  detailPair(metadata, 'Type', picked.type ?? picked.mime ?? '—')
  details.append(metadata, el('p', 'Timing breakdown', 'phase-title'))
  const phaseTrack = el('div', undefined, 'phase-track')
  phaseTrack.setAttribute('aria-hidden', 'true')
  appendSegments(phaseTrack, picked)
  details.append(phaseTrack)
  for (const [key, name] of phases) {
    if (picked.timings[key] === null || (key === 'other' && picked.timings[key] === 0)) continue
    const line = el('div', undefined, 'phase-line')
    const label = el('span', undefined, 'phase-name')
    label.append(el('i', undefined, 'swatch phase-' + key), el('span', name))
    line.append(label, el('span', ms(picked.timings[key]), 'phase-time'))
    details.append(line)
  }
}

function drawTable() {
  const rows = selectRows(trace.rows, {
    query: get('query').value, host: get('host').value,
    status: get('status').value, order: get('order').value,
  })
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  page = Math.min(lastPage, page)
  const offset = page * pageSize
  const visible = rows.slice(offset, offset + pageSize)
  if (!visible.some(row => row.id === picked?.id)) picked = visible[0] ?? null
  const body = get('requests')
  body.replaceChildren(...visible.map(makeRow))
  if (!visible.length) {
    const row = el('tr')
    const empty = el('td', trace.rows.length ? 'No requests match these filters.' : 'This trace has no HTTP requests with valid timestamps.', 'empty')
    empty.colSpan = 4
    row.append(empty)
    body.append(row)
  }
  get('shown').textContent = visible.length
    ? integer.format(offset + 1) + '–' + integer.format(offset + visible.length) + ' of ' + integer.format(rows.length)
    : '0 requests'
  get('pager').hidden = !lastPage
  get('previous').disabled = page <= 0
  get('next').disabled = page >= lastPage
  body.closest('.table-scroll').scrollTop = 0
  drawDetails()
}

function load(data, name, demo = false) {
  const incoming = readHar(data)
  trace = incoming
  get('source').textContent = name
  get('source-kind').textContent = demo ? 'Demo trace' : 'Local file'
  get('query').value = ''
  get('status').value = ''
  get('order').value = 'start'
  page = 0
  const hosts = [...new Set(trace.rows.map(row => row.host))].sort()
  const hostSelect = get('host')
  hostSelect.replaceChildren(new Option('All hosts', ''))
  for (const host of hosts) hostSelect.add(new Option(host, host))
  picked = trace.rows.slice(0, pageSize).reduce((longest, row) => (
    (row.duration ?? -1) > (longest?.duration ?? -1) ? row : longest
  ), null)
  setNotice(trace.skipped ? integer.format(trace.skipped) + ' entries skipped due to unsupported URLs or invalid timestamps.' : '')
  get('export').disabled = !trace.rows.length
  drawMetrics()
  drawAxis()
  drawTable()
}

async function openFile(file) {
  if (!file) return
  const id = ++importId
  if (file.size > 25 * 1024 * 1024) {
    setNotice('Choose a HAR of 25 MiB or less.', true)
    return
  }
  setNotice('Reading ' + file.name + '…')
  try {
    const text = (await file.text()).replace(/^\uFEFF/, '')
    if (id === importId) load(JSON.parse(text), file.name)
  } catch (error) {
    if (id === importId) {
      setNotice(error instanceof SyntaxError ? 'This file does not contain valid JSON.' : error.message, true)
    }
  }
}

get('demo').addEventListener('click', () => {
  importId++
  load(demoHar(), 'storefront.har', true)
})
get('open').addEventListener('click', () => get('file').click())
get('file').addEventListener('change', event => {
  openFile(event.target.files[0])
  event.target.value = ''
})
for (const id of ['query', 'host', 'status', 'order']) {
  get(id).addEventListener(id === 'query' ? 'input' : 'change', () => { page = 0; drawTable() })
}
get('previous').addEventListener('click', () => { page--; drawTable() })
get('next').addEventListener('click', () => { page++; drawTable() })
get('requests').addEventListener('click', event => {
  const row = event.target.closest('tr[data-id]')
  if (!row) return
  picked = trace.rows.find(request => request.id === Number(row.dataset.id))
  for (const tr of get('requests').querySelectorAll('tr[data-id]')) {
    tr.dataset.selected = String(tr === row)
    tr.querySelector('button').setAttribute('aria-pressed', tr.dataset.selected)
  }
  drawDetails()
})
get('export').addEventListener('click', () => {
  const object = new Blob([JSON.stringify(trace.summary, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(object)
  const link = el('a')
  link.href = url
  link.download = 'trace-metrics.json'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

window.addEventListener('dragover', event => {
  if (!Array.from(event.dataTransfer.types).includes('Files')) return
  event.preventDefault()
  get('drop').hidden = false
})
window.addEventListener('dragleave', event => {
  if (!event.relatedTarget) get('drop').hidden = true
})
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return
  event.preventDefault()
  get('drop').hidden = true
  openFile(event.dataTransfer.files[0])
})

for (const [key, label] of phases) {
  const item = el('span')
  item.append(el('i', undefined, 'swatch phase-' + key), document.createTextNode(label))
  get('legend').append(item)
}
load(demoHar(), 'storefront.har', true)
