const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const PORT = Number(process.env.PORT) || 3000
const HOST = '0.0.0.0'
const PUBLIC_ROOT = __dirname
const MAX_BODY_BYTES = 32 * 1024

const LIMITS = Object.freeze({ name:100, contact:150, comment:1000, source:150 })
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 5
const requestsByIp = new Map()

const PUBLIC_FILES = new Set(['index.html', 'privacy.html', 'consent.html'])
const PUBLIC_DIRECTORIES = new Set(['css', 'js', 'images', 'references'])
const MIME_TYPES = Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.gif':'image/gif',
  '.ico':'image/x-icon',
  '.woff':'font/woff',
  '.woff2':'font/woff2'
})

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'X-Content-Type-Options':'nosniff'
  })
  response.end(body)
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return request.socket?.remoteAddress || 'unknown'
}

function isRateLimited(ip) {
  const now = Date.now()
  const recent = (requestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)
  recent.push(now)
  requestsByIp.set(ip, recent)

  if (requestsByIp.size > 500) {
    for (const [key, timestamps] of requestsByIp) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) requestsByIp.delete(key)
    }
  }

  return recent.length > RATE_LIMIT_MAX_REQUESTS
}

async function readJsonBody(request) {
  const contentType = request.headers['content-type'] || ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Unsupported content type')
    error.status = 415
    throw error
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function cleanString(value, field, required = false) {
  if (value == null) value = ''
  if (typeof value !== 'string') throw new Error(`${field}: invalid type`)

  const cleaned = value.trim()
  if (required && !cleaned) throw new Error(`${field}: required`)
  if (cleaned.length > LIMITS[field]) throw new Error(`${field}: too long`)
  if (/[<>]/.test(cleaned)) throw new Error(`${field}: html is not allowed`)
  return cleaned
}

function buildTelegramMessage(lead) {
  return [
    '🎸 НОВАЯ ЗАЯВКА С САЙТА',
    '',
    `Имя: ${lead.name}`,
    `Связь: ${lead.contact}`,
    '',
    'Комментарий:',
    lead.comment || '—',
    '',
    'Источник:',
    lead.source || '—',
    '',
    'Согласие на обработку ПД: Да'
  ].join('\n')
}

async function handleLead(request, response, fetchImpl) {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const status = error.status || 400
    return sendJson(response, status, { ok:false, message:'Некорректные данные заявки' })
  }

  if (typeof body.website === 'string' && body.website.trim()) {
    return sendJson(response, 200, { ok:true })
  }

  if (isRateLimited(getClientIp(request))) {
    return sendJson(response, 429, { ok:false, message:'Слишком много запросов. Попробуйте позже' })
  }

  let lead
  try {
    if (body.personalDataConsent !== true) throw new Error('consent: required')
    lead = {
      name:cleanString(body.name, 'name', true),
      contact:cleanString(body.contact, 'contact', true),
      comment:cleanString(body.comment, 'comment'),
      source:cleanString(body.source, 'source'),
      personalDataConsent:true
    }
  } catch {
    return sendJson(response, 400, { ok:false, message:'Проверьте данные заявки' })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    console.error('Lead delivery is not configured: Telegram environment variables are missing')
    return sendJson(response, 500, { ok:false, message:'Не удалось отправить заявку' })
  }

  try {
    const telegramResponse = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ chat_id:chatId, text:buildTelegramMessage(lead) })
    })
    const telegramResult = await telegramResponse.json().catch(() => ({ ok:false }))

    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error(`Telegram sendMessage failed with status ${telegramResponse.status}`)
      return sendJson(response, 502, { ok:false, message:'Не удалось отправить заявку' })
    }

    return sendJson(response, 200, { ok:true })
  } catch (error) {
    console.error(`Telegram sendMessage request failed: ${error?.name || 'Error'}`)
    return sendJson(response, 502, { ok:false, message:'Не удалось отправить заявку' })
  }
}

function resolvePublicFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  if (decoded === '/') decoded = '/index.html'
  if (decoded.includes('\\') || decoded.includes('\0')) return null

  const relativePath = decoded.replace(/^\/+/, '')
  const firstSegment = relativePath.split('/')[0]
  if (!PUBLIC_FILES.has(relativePath) && !PUBLIC_DIRECTORIES.has(firstSegment)) return null

  const resolved = path.resolve(PUBLIC_ROOT, relativePath)
  if (resolved !== PUBLIC_ROOT && !resolved.startsWith(`${PUBLIC_ROOT}${path.sep}`)) return null
  return resolved
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    return sendJson(response, 405, { ok:false, message:'Метод не поддерживается' })
  }

  const filePath = resolvePublicFile(pathname)
  if (!filePath) return sendJson(response, 404, { ok:false, message:'Страница не найдена' })

  try {
    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile()) return sendJson(response, 404, { ok:false, message:'Страница не найдена' })

    const headers = {
      'Content-Type':MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length':stats.size,
      'X-Content-Type-Options':'nosniff',
      'Cache-Control':path.extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=3600'
    }
    response.writeHead(200, headers)
    if (request.method === 'HEAD') return response.end()
    fs.createReadStream(filePath).on('error', () => response.destroy()).pipe(response)
  } catch {
    return sendJson(response, 404, { ok:false, message:'Страница не найдена' })
  }
}

function createRequestHandler(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Node.js 20+ with global fetch is required')

  return async function requestHandler(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

    if (requestUrl.pathname === '/api/lead') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        return sendJson(response, 405, { ok:false, message:'Метод не поддерживается' })
      }
      return handleLead(request, response, fetchImpl)
    }

    return serveStatic(request, response, requestUrl.pathname)
  }
}

function createServer(fetchImpl = globalThis.fetch) {
  return http.createServer(createRequestHandler(fetchImpl))
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Denny Marron server is running on http://${HOST}:${PORT}`)
  })
}

module.exports = { createServer, createRequestHandler, handleLead, buildTelegramMessage }
