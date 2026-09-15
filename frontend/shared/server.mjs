#!/usr/bin/env node
/**
 * Zoo portal static server — hardened, zero-dependency Node HTTP server.
 *
 * Security properties:
 *  - serves ONLY from the configured ROOT (path traversal impossible:
 *    every request path is percent-decoded, normalized and re-verified)
 *  - strict security headers on every response (CSP without 'unsafe-inline'
 *    for scripts, no framing, no sniffing, strict referrer policy)
 *  - SPA fallback: unknown extensionless paths serve index.html; any path
 *    that looks like a file (has an extension) 404s instead of falling back
 *  - index.html: Cache-Control no-store (fresh app shell + immediate logout
 *    semantics); hashed /assets/: immutable 1y
 *  - only GET/HEAD are served; directory listing is never produced
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.env.ROOT || '.')
const PORT = Number(process.env.PORT || 3010)
const HOST = process.env.HOST || '0.0.0.0'
const API_ORIGIN = process.env.API_ORIGIN || 'http://10.8.0.28:3009'
const APP_NAME = process.env.APP_NAME || 'portal'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function securityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${API_ORIGIN}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  )
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
}

function send(res, status, body, headers = {}) {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (status === 204 || res.req?.method === 'HEAD') res.end()
  else res.end(body)
}

function tryFile(absPath, res, cacheControl) {
  let st
  try {
    st = fs.statSync(absPath)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  const ext = path.extname(absPath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const isAsset = absPath.includes(`${path.sep}assets${path.sep}`)
  securityHeaders(res)
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Length', st.size)
  res.setHeader(
    'Cache-Control',
    cacheControl || (isAsset ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate'),
  )
  if (res.req?.method === 'HEAD') {
    res.end()
  } else {
    const stream = fs.createReadStream(absPath)
    // Never let a mid-stream failure (dist swap, aborted client) crash the process.
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }
  return true
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/healthz') {
    securityHeaders(res)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return send(res, 200, JSON.stringify({ ok: true, app: APP_NAME, ts: new Date().toISOString() }))
  }

  // Percent-decode, strip null/control chars, normalize, then confine to ROOT.
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return send(res, 400, 'Bad Request')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\0-\x1f]/.test(pathname)) return send(res, 400, 'Bad Request')

  const cleaned = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const abs = path.join(ROOT, cleaned)

  // Confine: the resolved path MUST stay inside ROOT.
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) {
    return send(res, 403, 'Forbidden')
  }

  if (tryFile(abs, res)) return

  // Looks like a concrete file (has extension) → real 404, no SPA fallback.
  if (path.extname(cleaned) !== '') {
    return send(res, 404, 'Not Found')
  }

  // SPA fallback → app shell, never cached so auth state is always fresh.
  // (cache-control passed INTO tryFile: setting it after tryFile returns would
  //  throw ERR_HTTP_HEADERS_SENT once streaming has begun)
  const indexAbs = path.join(ROOT, 'index.html')
  if (tryFile(indexAbs, res, 'no-store')) return
  return send(res, 404, 'Not Found')
})

server.listen(PORT, HOST, () => {
  console.log(`[${APP_NAME}] serving ${ROOT} on http://${HOST}:${PORT} (API origin: ${API_ORIGIN})`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
