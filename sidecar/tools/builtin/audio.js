/* sidecar/tools/builtin/audio.js — the AUDIOLAB capability: audio_generate(prompt) + audio_generate(lyrics).
   New capability, not part of the shipped StarNet — fills a real gap: nothing in this codebase
   generates music/audio (edgetts.js is text-to-speech only, spotify.js is playback control only).

   Modeled directly on tools/builtin/image.js's factory/jail/deliverable pattern so it drops into
   the existing tool registry, capability system, and workspace jail with zero special-casing.

   Unlike image_generate (which rides the existing OpenRouter key), this talks to a LOCAL
   ACE-Step server — no API key, no per-call cost, matching the zero-budget constraint this was
   built for. ACE-Step exposes a simple HTTP endpoint when run locally; default assumed at
   http://localhost:7860 (Gradio's default port) — override via deps.baseUrl or ACE_STEP_URL env
   var if your local setup differs. VERIFY the exact request/response shape against your actual
   running ACE-Step instance before relying on this — it's built from the documented interface
   pattern, not a live-tested call against your specific setup.

   makeAudioTools({ fsp, pathMod, root, baseUrl?, fetchImpl?, defaultDurationSec? })
     -> { generateTool, register(reg), _internals }

   Node 18+ (global fetch). No dependencies. Reuses the fs.js workspace jail, same as image.js. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).audio = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  // tagged fail-open for the value-default catch below (house convention — see sidecar/failopen.js).
  // Guarded require so the browser build (which has no `require`) still loads; the fallback returns a
  // handler that yields the SAME default value, so behaviour is identical in both environments.
  const { swallow } = (typeof require === 'function')
    ? require('../../failopen.js')
    : { swallow: (tag, rv) => () => rv };

  const DEFAULT_BASE_URL = 'http://localhost:7860';
  const DEFAULT_DURATION_SEC = 30;
  const MAX_DURATION_SEC = 240;
  const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60MB safety cap
  const GEN_TIMEOUT_MS = 120000; // audio generation runs longer than image generation

  function withTimeout(fn, ms) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    return fn(controller.signal).finally(() => clearTimeout(t));
  }

  function makeAudioTools(deps) {
    deps = deps || {};
    const baseUrl = String(deps.baseUrl || process.env.ACE_STEP_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('audio.js requires { fsp, pathMod, root }');
    const doFetch = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) throw new Error('audio.js requires global fetch (Node 18+) or deps.fetchImpl');
    const defaultDuration = deps.defaultDurationSec || DEFAULT_DURATION_SEC;
    // reuse the ONE workspace jail (fs.js) so generated audio paths can't escape the agent's directory
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'audio_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'audio', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    // ACE-Step's local server is assumed to accept a JSON POST and return either a base64-encoded
    // audio payload or a local file path it wrote — both branches are handled below. Adjust the
    // request/response shape here to match your actual running instance if it differs.
    async function acePost(body, timeoutMs) {
      let res;
      try {
        res = await withTimeout(signal => doFetch(baseUrl + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        }).then(async r => ({ status: r.status, json: await r.json().catch(swallow('audio.response.read', null)) })), timeoutMs);
      } catch (e) {
        throw new Error('AUDIOLAB could not reach ACE-Step at ' + baseUrl + ' (' + (e && e.message || e) +
          '). Is it running locally? Set ACE_STEP_URL if it is on a different host/port.');
      }
      if (res.status < 200 || res.status >= 300) {
        const errMsg = res.json && (res.json.error || res.json.message) || ('http ' + res.status);
        throw new Error('ACE-Step ' + res.status + ': ' + (typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)));
      }
      return res.json || {};
    }

    // ---------------- audio_generate ----------------
    const generateTool = {
      name: 'audio_generate', capability: 'audiolab', scope: 'write', requiresConsent: true, timeoutMs: GEN_TIMEOUT_MS + 15000,
      description: 'Generate music/audio from a text prompt using a LOCAL ACE-Step instance (no API key, no per-call cost) ' +
        'and SAVE it into your workspace (returns the saved path + a viewer URL). Use for any "make/generate a track/beat/loop/song ' +
        'of …" request. Optional "lyrics" adds vocals if the model/config supports them. Optional "duration_sec" sets length ' +
        '(default ' + defaultDuration + 's, max ' + MAX_DURATION_SEC + 's). Optional "path" sets the output filename. Requires ACE-Step ' +
        'running locally (default ' + DEFAULT_BASE_URL + ', override with ACE_STEP_URL).',
      schema: { type: 'object', required: ['prompt'], properties: {
        prompt: { type: 'string', description: 'style/genre/mood description, e.g. "lofi hip-hop, rainy, mellow piano"' },
        lyrics: { type: 'string', description: 'optional lyrics, if the local model/config supports vocals' },
        duration_sec: { type: 'integer', minimum: 5, maximum: MAX_DURATION_SEC },
        path: { type: 'string' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        const prompt = String(args.prompt || '').trim();
        if (!prompt) throw new Error('prompt is required');
        const duration = Math.min(Math.max(Number(args.duration_sec) || defaultDuration, 5), MAX_DURATION_SEC);

        const data = await acePost({
          prompt,
          lyrics: args.lyrics ? String(args.lyrics) : undefined,
          duration_sec: duration
        }, GEN_TIMEOUT_MS);

        // Two response shapes handled: a base64 data payload, or a local file path ACE-Step
        // already wrote to disk that we then read in. Adjust to match your actual instance.
        let buffer, mime = 'audio/wav';
        if (data.audio_base64) {
          buffer = Buffer.from(String(data.audio_base64), 'base64');
          if (data.mime) mime = String(data.mime);
        } else if (data.file_path) {
          buffer = await fsp.readFile(String(data.file_path));
        } else {
          throw new Error('ACE-Step returned no recognizable audio payload (expected audio_base64 or file_path) — check your local instance\'s response shape.');
        }

        if (buffer.length > MAX_AUDIO_BYTES) throw new Error('generated audio too large (' + buffer.length + ' bytes)');

        const ext = mime.indexOf('mp3') >= 0 ? '.mp3' : '.wav';
        let rel = String(args.path || '').trim();
        if (rel) { if (!/\.[a-z0-9]+$/i.test(rel)) rel += ext; }
        else {
          const h = require('node:crypto').createHash('sha1').update(buffer).digest('hex').slice(0, 12);
          rel = 'audio/gen-' + h + ext;
        }
        const { abs } = await jail.resolveInside(aid, rel);   // throws on jail escape / abs / '..'
        await fsp.mkdir(P.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buffer);
        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        const kb = (buffer.length / 1024).toFixed(0) + ' KB';
        return {
          content: 'Generated and saved ' + rel + ' (' + kb + ', ' + mime + ', ' + duration + 's).\nView: ' + viewer,
          summary: 'audio → ' + rel
        };
      }
    };

    return {
      generateTool,
      _internals: { acePost },
      register(reg) { reg.register(generateTool); return reg; }
    };
  }

  return { makeAudioTools };
});
