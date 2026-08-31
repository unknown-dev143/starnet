/* sidecar/tools/builtin/compose.js — the EDITING BAY capability: video_compose(audio, image).
   New capability, filling a real gap: audiolab makes audio, studio makes images, cinema makes
   short AI video clips — but NOTHING assembles them into one finished, long-form video. This is
   that missing step: the classic "static/looping background + full-length audio track" format
   used for lofi/study/ambient YouTube videos.

   Shells out to a LOCAL ffmpeg install (not bundled — you need `ffmpeg` on PATH). Checked
   explicitly before doing anything else, with a clear, actionable error if it's missing, rather
   than a cryptic spawn failure.

   makeComposeTools({ fsp, pathMod, root, execFileImpl? }) -> { composeTool, register(reg), _internals }

   Node 18+. Reuses the fs.js workspace jail, same as image.js/audio.js/video.js — both the audio
   and image inputs must already exist inside the SAME agent's workspace (i.e. paths returned by
   a prior audio_generate / image_generate call), and the output is written there too. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).compose = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');

  const MAX_OUTPUT_BYTES = 500 * 1024 * 1024; // 500MB safety cap
  const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;   // long videos can genuinely take minutes to encode

  function makeComposeTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('compose.js requires { fsp, pathMod, root }');
    const execFileAsync = deps.execFileImpl
      ? promisify(deps.execFileImpl)
      : promisify(execFile);
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'video_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'video', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    let ffmpegChecked = false, ffmpegOk = false;
    async function ensureFfmpeg() {
      if (ffmpegChecked) {
        if (!ffmpegOk) throw new Error('ffmpeg is not available on PATH. Install it (ffmpeg.org/download.html, or "winget install ffmpeg" on Windows) and restart the app.');
        return;
      }
      ffmpegChecked = true;
      try {
        await execFileAsync('ffmpeg', ['-version'], { timeout: 10000 });
        ffmpegOk = true;
      } catch (e) {
        ffmpegOk = false;
        throw new Error('ffmpeg is not available on PATH (' + (e && e.message || e) +
          '). Install it (ffmpeg.org/download.html, or "winget install ffmpeg" on Windows) and restart the app — EDITING BAY needs it to assemble video.');
      }
    }

    // ---------------- video_compose ----------------
    const composeTool = {
      name: 'video_compose', capability: 'editingbay', scope: 'write', requiresConsent: true, timeoutMs: FFMPEG_TIMEOUT_MS + 15000,
      description: 'Assemble a finished, full-length video from a previously-generated audio file and a still image ' +
        '(e.g. from audio_generate + image_generate) — the classic "looping background + full-length music" format used ' +
        'for lofi/study/ambient YouTube videos. The output runs exactly as long as the audio. Requires a local ffmpeg ' +
        'install (not bundled). Give it the SAVED PATHS returned by earlier audio_generate/image_generate calls in this ' +
        'same agent workspace, not raw prompts.',
      schema: { type: 'object', required: ['audio_path', 'image_path'], properties: {
        audio_path: { type: 'string', description: 'workspace-relative path to an already-generated audio file' },
        image_path: { type: 'string', description: 'workspace-relative path to an already-generated still image' },
        path: { type: 'string', description: 'output filename (defaults to video/compose-<hash>.mp4)' }
      } },
      run: async (args, ctx) => {
        await ensureFfmpeg();
        const aid = (ctx && ctx.agentId) || 'agent';
        const audioRel = String(args.audio_path || '').trim();
        const imageRel = String(args.image_path || '').trim();
        if (!audioRel) throw new Error('audio_path is required');
        if (!imageRel) throw new Error('image_path is required');

        // Both inputs must already exist inside THIS agent's jailed workspace — resolveInside
        // throws on any path-escape attempt, same guarantee as every other tool here.
        const { abs: audioAbs } = await jail.resolveInside(aid, audioRel);
        const { abs: imageAbs } = await jail.resolveInside(aid, imageRel);
        try { await fsp.access(audioAbs); } catch { throw new Error('audio_path does not exist in this workspace: ' + audioRel); }
        try { await fsp.access(imageAbs); } catch { throw new Error('image_path does not exist in this workspace: ' + imageRel); }

        let rel = String(args.path || '').trim();
        if (rel) { if (!/\.[a-z0-9]+$/i.test(rel)) rel += '.mp4'; }
        else {
          const h = require('node:crypto').createHash('sha1').update(audioAbs + imageAbs).digest('hex').slice(0, 12);
          rel = 'video/compose-' + h + '.mp4';
        }
        const { abs: outAbs } = await jail.resolveInside(aid, rel);
        await fsp.mkdir(P.dirname(outAbs), { recursive: true });

        // Standard "static image + full audio track" mux: loop the still, cut to the audio's
        // length (-shortest with a looped image input means "stop when the audio ends"),
        // yuv420p for broad player/YouTube compatibility.
        const ffArgs = [
          '-y',
          '-loop', '1', '-i', imageAbs,
          '-i', audioAbs,
          '-c:v', 'libx264', '-tune', 'stillimage',
          '-c:a', 'aac', '-b:a', '192k',
          '-pix_fmt', 'yuv420p',
          '-shortest',
          outAbs
        ];

        try {
          await execFileAsync('ffmpeg', ffArgs, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 20 });
        } catch (e) {
          throw new Error('ffmpeg failed to assemble the video: ' + ((e && e.stderr) ? String(e.stderr).slice(-500) : (e && e.message) || e));
        }

        const stat = await fsp.stat(outAbs);
        if (stat.size > MAX_OUTPUT_BYTES) {
          await fsp.unlink(outAbs).catch(() => {});
          throw new Error('assembled video too large (' + stat.size + ' bytes) — use a shorter audio track');
        }

        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        const mb = (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
        return {
          content: 'Assembled and saved ' + rel + ' (' + mb + ').\nView: ' + viewer,
          summary: 'video → ' + rel
        };
      }
    };

    return {
      composeTool,
      _internals: { ensureFfmpeg },
      register(reg) { reg.register(composeTool); return reg; }
    };
  }

  return { makeComposeTools };
});
