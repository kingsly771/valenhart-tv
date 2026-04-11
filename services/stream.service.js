/**
 * VALENHART TV v11 — Universal Stream Router
 *
 * Handles every IPTV link type:
 *   http/https  → HLS (.m3u8), DASH (.mpd), TS, FLV, MP4, direct
 *   rtsp://     → FFmpeg transcode → HLS
 *   rtmp://     → FFmpeg transcode → HLS
 *   rtmps://    → FFmpeg transcode → HLS
 *   udp://      → FFmpeg transcode → HLS
 *   rtp://      → FFmpeg transcode → HLS
 *   srt://      → FFmpeg transcode → HLS
 *   mms://      → FFmpeg transcode → HLS
 *   mmsh://     → FFmpeg transcode → HLS
 *
 * Routes:
 *   GET /api/stream/probe?url=     — detect format, return play strategy
 *   GET /api/stream/hls?url=       — transcode any protocol → live HLS
 *   GET /api/proxy/stream?url=     — existing HTTP proxy (enhanced)
 */

const express   = require('express');
const router    = express.Router();
const { spawn } = require('child_process');
const path      = require('path');
const fetch     = require('node-fetch');
const crypto    = require('crypto');

// ── FFmpeg availability check ──────────────────────────
let FFMPEG_PATH = 'ffmpeg';
let _ffmpegAvailable = null;

async function checkFFmpeg() {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  return new Promise(resolve => {
    const proc = spawn(FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
    proc.on('close', code => { _ffmpegAvailable = code === 0; resolve(_ffmpegAvailable); });
    proc.on('error', () => { _ffmpegAvailable = false; resolve(false); });
  });
}

// ── Protocol detection ─────────────────────────────────
function detectProtocol(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.startsWith('rtsp://'))         return 'rtsp';
  if (u.startsWith('rtmp://'))         return 'rtmp';
  if (u.startsWith('rtmps://'))        return 'rtmps';
  if (u.startsWith('rtmpe://'))        return 'rtmpe';
  if (u.startsWith('rtmpt://'))        return 'rtmpt';
  if (u.startsWith('udp://'))          return 'udp';
  if (u.startsWith('rtp://'))          return 'rtp';
  if (u.startsWith('srt://'))          return 'srt';
  if (u.startsWith('mms://'))          return 'mms';
  if (u.startsWith('mmsh://'))         return 'mmsh';
  if (u.startsWith('mmst://'))         return 'mmst';
  if (u.startsWith('http://') || u.startsWith('https://')) {
    const base = u.split('?')[0];
    if (base.includes('.m3u8') || base.includes('/hls/') || base.includes('type=m3u'))  return 'hls';
    if (base.includes('.mpd'))          return 'dash';
    if (base.includes('.flv'))          return 'flv';
    if (base.includes('.ts') || base.includes('/ts/')) return 'ts';
    if (base.endsWith('.mp4') || base.endsWith('.mkv') || base.endsWith('.avi') || base.endsWith('.mov')) return 'vod';
    if (base.includes('/live/') || base.includes('/stream'))  return 'hls';  // Xtream live
    if (base.includes('/movie/'))       return 'vod';  // Xtream VOD
    if (base.includes('/series/'))      return 'vod';  // Xtream series
    return 'http';  // Unknown HTTP — let client probe
  }
  return 'unknown';
}

// ── Play strategy: what the client should do ──────────
function getPlayStrategy(url, protocol) {
  switch (protocol) {
    case 'hls':   return { type: 'hls',    url,         player: 'hlsjs'  };
    case 'dash':  return { type: 'dash',   url,         player: 'dashjs' };
    case 'flv':   return { type: 'flv',    url,         player: 'flvjs'  };
    case 'ts':    return { type: 'hls',    url,         player: 'hlsjs'  }; // TS → HLS.js handles it
    case 'vod':   return { type: 'native', url,         player: 'video'  };
    case 'http':  return { type: 'probe',  url,         player: 'auto'   }; // Client should probe
    case 'rtsp':
    case 'rtmp':
    case 'rtmps':
    case 'rtmpe':
    case 'rtmpt':
    case 'udp':
    case 'rtp':
    case 'srt':
    case 'mms':
    case 'mmsh':
    case 'mmst':
      return { type: 'transcode', url: `/api/stream/hls?url=${encodeURIComponent(url)}`, player: 'hlsjs', originalProtocol: protocol };
    default:
      return { type: 'unknown', url, player: 'none' };
  }
}

// ══════════════════════════════════════════════════════
//  GET /api/stream/probe?url=
//  Returns detected protocol + recommended play strategy
// ══════════════════════════════════════════════════════
router.get('/probe', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const decoded  = decodeURIComponent(url);
  const protocol = detectProtocol(decoded);
  const strategy = getPlayStrategy(decoded, protocol);
  const ffmpeg   = await checkFFmpeg();

  res.json({
    url:      decoded,
    protocol,
    strategy,
    ffmpegAvailable: ffmpeg,
    canTranscode: ffmpeg && ['rtsp','rtmp','rtmps','rtmpe','rtmpt','udp','rtp','srt','mms','mmsh','mmst'].includes(protocol),
  });
});

// ══════════════════════════════════════════════════════
//  GET /api/stream/hls?url=&bitrate=&segment=
//
//  Pipes any supported input through FFmpeg and outputs
//  a live HLS stream (chunked .m3u8 + .ts segments).
//
//  This endpoint streams an HLS playlist inline using
//  pipe: output — no disk writes needed.
//  The client opens this URL with HLS.js like any .m3u8.
//
//  Implementation: FFmpeg → pipe:1 → HTTP chunked response
//  with content-type application/vnd.apple.mpegurl
// ══════════════════════════════════════════════════════
router.get('/hls', async (req, res) => {
  const { url, bitrate = '1500k', vcodec = 'copy', acodec = 'aac' } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const decoded  = decodeURIComponent(url);
  const protocol = detectProtocol(decoded);

  const ffmpegOk = await checkFFmpeg();
  if (!ffmpegOk) {
    return res.status(503).json({
      error: 'FFmpeg not available on this server. Install FFmpeg to enable RTSP/RTMP/UDP transcoding.',
      install: 'https://ffmpeg.org/download.html',
    });
  }

  // Build FFmpeg input args per protocol
  const inputArgs = buildFFmpegInputArgs(decoded, protocol);
  const outputArgs = buildFFmpegOutputArgs(bitrate, vcodec, acodec);

  const args = [
    '-loglevel', 'error',
    ...inputArgs,
    ...outputArgs,
    // Output HLS to stdout
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments+append_list',
    'pipe:1',
  ];

  res.setHeader('Content-Type',  'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stdout.pipe(res);

  ff.stderr.on('data', d => {
    // Log FFmpeg errors but don't crash
    const msg = d.toString();
    if (msg.includes('Error') || msg.includes('error')) {
      console.warn('[FFmpeg]', msg.trim());
    }
  });

  ff.on('close', code => {
    if (!res.writableEnded) {
      res.end();
    }
  });

  ff.on('error', err => {
    console.error('[FFmpeg spawn error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg process failed: ' + err.message });
    }
  });

  req.on('close', () => {
    // Client disconnected — kill FFmpeg
    ff.kill('SIGTERM');
  });
});

// ══════════════════════════════════════════════════════
//  GET /api/stream/snapshot?url=
//  Grab a single JPEG thumbnail from any stream via FFmpeg
// ══════════════════════════════════════════════════════
router.get('/snapshot', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  const ffmpegOk = await checkFFmpeg();
  if (!ffmpegOk) return res.status(503).json({ error: 'FFmpeg not available' });

  const decoded  = decodeURIComponent(url);
  const protocol = detectProtocol(decoded);
  const inputArgs = buildFFmpegInputArgs(decoded, protocol);

  const args = [
    '-loglevel', 'error',
    ...inputArgs,
    '-vframes', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ];

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=30');

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  ff.stdout.pipe(res);
  ff.on('error', () => res.status(500).end());
  req.on('close', () => ff.kill('SIGTERM'));
});

// ══════════════════════════════════════════════════════
//  ENHANCED GET /api/proxy/stream?url=
//  Extended to handle more content-types and auth headers
// ══════════════════════════════════════════════════════
router.get('/proxy', async (req, res) => {
  const { url, ua, referer, origin } = req.query;
  if (!url) return res.status(400).send('url required');

  const decoded  = decodeURIComponent(url);
  const protocol = detectProtocol(decoded);

  // Non-HTTP protocols → redirect to transcoder
  if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) {
    const transcodeUrl = `/api/stream/hls?url=${encodeURIComponent(decoded)}`;
    return res.redirect(302, transcodeUrl);
  }

  try {
    const headers = {
      'User-Agent': ua ? decodeURIComponent(ua) : 'VLC/3.0.16 LibVLC/3.0.16',
      'Accept':     '*/*',
    };
    if (referer) headers['Referer']  = decodeURIComponent(referer);
    if (origin)  headers['Origin']   = decodeURIComponent(origin);

    const upstream = await fetch(decoded, { headers });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    // Forward content-length if present
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);

    // Rewrite M3U8 segment URLs to proxy through us
    if (ct.includes('mpegurl') || decoded.includes('.m3u8') || decoded.includes('type=m3u')) {
      const text = await upstream.text();
      const base = getBaseUrl(decoded);
      const rewritten = rewriteM3U8(text, base);
      return res.send(rewritten);
    }

    upstream.body.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
function buildFFmpegInputArgs(url, protocol) {
  const args = [];

  switch (protocol) {
    case 'rtsp':
      args.push(
        '-rtsp_transport', 'tcp',   // prefer TCP for reliability
        '-timeout', '10000000',     // 10s timeout (microseconds)
        '-i', url
      );
      break;

    case 'rtmp':
    case 'rtmps':
    case 'rtmpe':
    case 'rtmpt':
      args.push(
        '-timeout', '10000000',
        '-i', url
      );
      break;

    case 'udp':
    case 'rtp':
      args.push(
        '-buffer_size', '32768',
        '-i', url
      );
      break;

    case 'srt':
      args.push(
        '-i', url
      );
      break;

    case 'mms':
    case 'mmsh':
    case 'mmst':
      args.push('-i', url);
      break;

    default:
      // HTTP/HTTPS with VLC user-agent
      args.push(
        '-user_agent', 'VLC/3.0.16 LibVLC/3.0.16',
        '-timeout', '10000000',
        '-i', url
      );
  }

  return args;
}

function buildFFmpegOutputArgs(bitrate, vcodec, acodec) {
  // If vcodec=copy we just remux (fastest, no quality loss)
  // Otherwise transcode to h264
  const vc = vcodec === 'copy' ? 'copy' : 'libx264';
  const ac = acodec || 'aac';

  const args = [
    '-c:v', vc,
    '-c:a', ac,
  ];

  if (vc !== 'copy') {
    args.push(
      '-b:v', bitrate,
      '-preset', 'ultrafast',
      '-tune',   'zerolatency',
      '-crf',    '28',
    );
  }

  if (ac !== 'copy') {
    args.push('-b:a', '128k', '-ar', '44100');
  }

  return args;
}

function rewriteM3U8(text, base) {
  return text.replace(/^(?!#)(.+)$/gm, line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    let absolute;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      absolute = trimmed;
    } else if (trimmed.startsWith('/')) {
      const u = new URL(base);
      absolute = u.origin + trimmed;
    } else {
      absolute = base + '/' + trimmed;
    }
    return `/api/stream/proxy?url=${encodeURIComponent(absolute)}`;
  });
}

function getBaseUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/[^/]*$/, '');
  } catch { return ''; }
}

module.exports = { router, detectProtocol, getPlayStrategy, checkFFmpeg };
