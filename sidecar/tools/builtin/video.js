/* sidecar/tools/builtin/video.js — the CINEMA capability: video_generate(prompt).
   New capability, not part of the shipped StarNet — no video generation tool exists in this
   codebase (image.js is stills only, edgetts.js/audio.js are audio only).

   Rides the SAME OpenRouter connection as image.js (deps.openrouter.apiKey) — no separate
   signup, no separate key. Uses OpenRouter's real, documented async video API:
     POST  /api/v1/videos              -> { id, status, ... }        (submit)
     GET   /api/v1/videos/{id}         -> { status, ... }             (poll)
     GET   /api/v1/videos/{id}/content?index=0 -> raw video bytes     (download)
   per openrouter.ai/docs/guides/overview/multimodal/video-generation — this is genuinely
   documented, not guessed (unlike an earlier draft of the audio tool, which had to be
   corrected after checking ACE-Step's real API instead of assuming one).

   Video generation is billed per OpenRouter's video model pricing — unlike audio.js's local
   ACE-Step path, this is NOT free. Costs vary by model/resolution/duration; check
   /api/v1/videos/models before relying on a specific price.

   Model slugs drift as providers add/rename models — DEFAULT_MODEL below is a reasonable
   starting point (Seedance's "fast" tier, built for lower cost) but VERIFY against
   GET /api/v1/videos/models before depending on it; this file surfaces the real error text
   from OpenRouter if the slug is wrong rather than failing silently.

   makeVideoTools({ openrouter:{apiKey, baseUrl?}, fsp, pathMod, root, fetchImpl?, model?, now? })
     -> { generateTool, register(reg), _internals }

   `now` is an INJECTED clock (a () => ms). The poll deadline must read it, never an ambient Date.now() —
   backend logic may not touch ambient time (test/lint-determinism.js).

   Node 18+ (global fetch). No dependencies. Reuses the fs.js workspace jail, same as image.js. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).video = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  // tagged fail-open for the value-default catches below (house convention — see sidecar/failopen.js).
  // Guarded require so the browser build (which has no `require`) still loads; the fallback returns a
  // handler that yields the SAME default value, so behaviour is identical in both environments.
  const { swallow } = (typeof require === 'function')
    ? require('../../failopen.js')
    : { swallow: (tag, rv) => () => rv };

  const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
  const DEFAULT_MODEL = 'bytedance/seedance-2.0-fast'; // cost/speed-optimized tier — VERIFY via /api/v1/videos/models
  const DEFAULT_DURATION_SEC = 5;
  const MAX_DURATION_SEC = 12;
  const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB safety cap
  const POLL_INTERVAL_MS = 4000;
  const MAX_WAIT_MS = 6 * 60 * 1000; // video jobs can genuinely take minutes

  function withTimeout(promiseFactory, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return Promise.resolve(promiseFactory(ctrl.signal)).finally(() => clearTimeout(t));
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function makeVideoTools(deps) {
    deps = deps || {};
    const or = deps.openrouter || {};
    const apiKey = or.apiKey || deps.apiKey || '';
    const baseUrl = String(or.baseUrl || OPENROUTER_BASE).replace(/\/+$/, '');
    const model = deps.model || DEFAULT_MODEL;
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root, now = deps.now;
    if (!fsp || !P || !ROOT) throw new Error('video.js requires { fsp, pathMod, root }');
    if (typeof now !== 'function') throw new Error('video.js requires { now } — an injected clock; ambient time is banned by lint-determinism');
    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('video.js requires global fetch (Node 18+) or deps.fetchImpl');
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function authHeaders(extra) {
      return Object.assign({ 'Authorization': 'Bearer ' + apiKey, 'HTTP-Referer': 'https://starnet.local', 'X-Title': 'STARNET' }, extra || {});
    }

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'video_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'video', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    async function submitJob({ prompt, durationSec, aspectRatio, resolution }) {
      const body = { model, prompt };
      if (durationSec) body.duration = durationSec;
      if (aspectRatio) body.aspect_ratio = aspectRatio;
      if (resolution) body.resolution = resolution;

      const res = await withTimeout(signal => doFetch(baseUrl + '/videos', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal
      }), 30000);
      const data = await res.json().catch(swallow('cinema.submit.read', null));
      if (!res.ok) {
        const msg = (data && (data.error && data.error.message || data.message)) || ('http ' + res.status);
        throw new Error('CINEMA could not submit video job (model "' + model + '"): ' + msg +
          '. If this is a "model not found" error, check GET ' + baseUrl + '/videos/models for a current valid slug.');
      }
      const id = data && (data.id || (data.data && data.data.id));
      if (!id) throw new Error('CINEMA: OpenRouter accepted the job but returned no job id — response: ' + JSON.stringify(data).slice(0, 300));
      return id;
    }

    async function pollJob(id) {
      const deadline = now() + MAX_WAIT_MS;
      while (now() < deadline) {
        const res = await withTimeout(signal => doFetch(baseUrl + '/videos/' + encodeURIComponent(id), {
          headers: authHeaders(), signal
        }), 20000);
        const data = await res.json().catch(swallow('cinema.poll.read', null));
        if (!res.ok) throw new Error('CINEMA polling failed: http ' + res.status + ' ' + JSON.stringify(data).slice(0, 200));
        const status = data && data.status;
        if (status === 'completed' || status === 'succeeded') return data;
        if (status === 'failed' || status === 'error') {
          throw new Error('CINEMA: video job failed — ' + ((data && (data.error || data.message)) || 'no error detail returned'));
        }
        await sleep(POLL_INTERVAL_MS);
      }
      throw new Error('CINEMA: video job did not complete within ' + Math.round(MAX_WAIT_MS / 1000) + 's — it may still finish later; job id was ' + id);
    }

    async function downloadContent(id) {
      // Documented download route. Fall back to unsigned_urls from the poll response if present
      // and this fails, since OpenRouter's async APIs have offered both patterns historically.
      const res = await withTimeout(signal => doFetch(baseUrl + '/videos/' + encodeURIComponent(id) + '/content?index=0', {
        headers: authHeaders(), signal
      }), 60000);
      if (!res.ok) throw new Error('CINEMA could not download finished video: http ' + res.status);
      const arrBuf = await res.arrayBuffer();
      return Buffer.from(arrBuf);
    }

    // ---------------- video_generate ----------------
    const generateTool = {
      name: 'video_generate', capability: 'cinema', scope: 'write', requiresConsent: true, timeoutMs: MAX_WAIT_MS + 60000,
      description: 'Generate a short video clip from a text prompt via OpenRouter (uses the same connected key as image ' +
        'generation — billed per OpenRouter\'s video pricing, NOT free like the local audio lab) and SAVE it into your workspace. ' +
        'Use for "make/generate a video/clip of …" requests. Takes ' + Math.round(DEFAULT_DURATION_SEC) + '-' + MAX_DURATION_SEC +
        's typically; can take several minutes to finish. Optional "duration_sec" (max ' + MAX_DURATION_SEC + '), "aspect_ratio" ' +
        '(e.g. "16:9"), "resolution", "path".',
      schema: { type: 'object', required: ['prompt'], properties: {
        prompt: { type: 'string', description: 'scene/action/style description' },
        duration_sec: { type: 'integer', minimum: 2, maximum: MAX_DURATION_SEC },
        aspect_ratio: { type: 'string' },
        resolution: { type: 'string' },
        path: { type: 'string' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        if (!apiKey) throw new Error('CINEMA is unavailable: no OpenRouter API key is connected. Open SETTINGS > PROVIDERS and connect OpenRouter, then retry; no video was produced.');
        const prompt = String(args.prompt || '').trim();
        if (!prompt) throw new Error('prompt is required');
        const duration = Math.min(Math.max(Number(args.duration_sec) || DEFAULT_DURATION_SEC, 2), MAX_DURATION_SEC);

        const jobId = await submitJob({ prompt, durationSec: duration, aspectRatio: args.aspect_ratio, resolution: args.resolution });
        const finished = await pollJob(jobId);
        let buffer;
        try {
          buffer = await downloadContent(jobId);
        } catch (e) {
          const fallbackUrl = finished && finished.unsigned_urls && finished.unsigned_urls[0];
          if (!fallbackUrl) throw e;
          const r2 = await doFetch(fallbackUrl);
          if (!r2.ok) throw e;
          buffer = Buffer.from(await r2.arrayBuffer());
        }
        if (buffer.length > MAX_VIDEO_BYTES) throw new Error('generated video too large (' + buffer.length + ' bytes)');

        let rel = String(args.path || '').trim();
        if (rel) { if (!/\.[a-z0-9]+$/i.test(rel)) rel += '.mp4'; }
        else {
          const h = require('node:crypto').createHash('sha1').update(buffer).digest('hex').slice(0, 12);
          rel = 'video/gen-' + h + '.mp4';
        }
        const { abs } = await jail.resolveInside(aid, rel);
        await fsp.mkdir(P.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buffer);
        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        const mb = (buffer.length / (1024 * 1024)).toFixed(1) + ' MB';
        return {
          content: 'Generated and saved ' + rel + ' (' + mb + ', ' + duration + 's, model ' + model + ').\nView: ' + viewer,
          summary: 'video → ' + rel
        };
      }
    };

    return {
      generateTool,
      _internals: { submitJob, pollJob, downloadContent },
      register(reg) { reg.register(generateTool); return reg; }
    };
  }

  return { makeVideoTools };
});
