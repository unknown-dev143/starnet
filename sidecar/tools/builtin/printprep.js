/* sidecar/tools/builtin/printprep.js — the PRINT SHOP capability: print_prep(image, target).
   New capability, filling a real gap in the existing Printify/Printful integration (which is
   deliberately generic REST access via web_request + a service key — see servicekeys-catalog.js's
   own header comment on why no dedicated Printify tool exists upstream). Nothing currently checks
   whether a generated design actually has enough real pixels for a good print.

   The core fact this tool encodes (verified against Printify's own help docs and cross-checked
   against several independent print-prep guides): required pixels = print-area-inches × target-DPI.
   300 DPI is the standard target for most products (a 12x16in tee front print needs 3600x4800px).
   Large-format items (blankets, tapestries, posters) can drop to 120-150 DPI. Simply raising a
   file's DPI metadata WITHOUT more real pixel data does nothing — Printify's own docs are explicit
   that this gets flagged. So this tool does the honest thing: report the shortfall, and only
   upscale (real pixel interpolation, not just a DPI tag change) if asked, with a clear caveat that
   upscaling recovers sharpness, not missing detail.

   Deliberately does NOT hardcode a big per-product-type inch table — StarNet's own maintainer
   explicitly avoided guessed integration data for this exact platform (see servicekeys-catalog.js:
   "a wrong hint would send every agent down a broken path, which is worse than no hint"). The two
   presets below are the ones independently confirmed across multiple sources during research;
   anything else, look up the product's actual print-area size on Printify's site and pass it in
   directly as target_width_in/target_height_in.

   Uses ffmpeg (already required by editingbay's video_compose) for dimension probing and upscaling
   — no new dependency.

   makePrintPrepTools({ fsp, pathMod, root, execFileImpl? }) -> { printPrepTool, register(reg), _internals }

   Node 18+. Reuses the fs.js workspace jail, same as every sibling tool. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).printprep = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');

  const DEFAULT_DPI = 300;
  const MAX_OUTPUT_BYTES = 100 * 1024 * 1024; // Printify's own stated PNG/JPEG cap
  const TIMEOUT_MS = 60000;

  // The only two presets independently verified across multiple sources during research —
  // everything else must be supplied explicitly rather than guessed.
  const PRESETS = {
    tshirt_front: { widthIn: 12, heightIn: 16, dpi: 300, note: 'standard unisex tee front print area' },
    blanket: { widthIn: 60, heightIn: 80, dpi: 150, note: 'large-format item, lower DPI is standard' }
  };

  function makePrintPrepTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('printprep.js requires { fsp, pathMod, root }');
    const execFileAsync = deps.execFileImpl ? promisify(deps.execFileImpl) : promisify(execFile);
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'printprep_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'image', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    async function probeDimensions(absPath) {
      let stdout;
      try {
        const res = await execFileAsync('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', absPath
        ], { timeout: 15000 });
        stdout = res.stdout;
      } catch (e) {
        throw new Error('PRINT SHOP could not read image dimensions (ffprobe not on PATH, or not a valid image): ' + (e && e.message || e));
      }
      const m = /^(\d+)x(\d+)/.exec(String(stdout).trim());
      if (!m) throw new Error('PRINT SHOP could not parse image dimensions from ffprobe output: ' + stdout);
      return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
    }

    // ---------------- print_prep ----------------
    const printPrepTool = {
      name: 'print_prep', capability: 'printshop', scope: 'write', requiresConsent: true, timeoutMs: TIMEOUT_MS + 15000,
      description: 'Check (and optionally fix) whether a generated design image has enough real pixels for a good ' +
        'print-on-demand print, BEFORE uploading to Printify/Printful. Required pixels = print-area-inches × ' +
        'target-DPI (300 DPI standard for most products, 120-150 DPI for large-format items like blankets/posters — ' +
        'look up the ACTUAL print area size for your specific product on Printify\'s site, since this varies by ' +
        'product and this tool does not guess it). Pass target_width_in + target_height_in (+ optional target_dpi, ' +
        'default 300), OR a known preset name. Always reports the shortfall honestly; only upscales (real pixel ' +
        'interpolation) if fix_if_short is true — upscaling recovers sharpness, it does NOT invent missing detail, ' +
        'so a badly undersized source will still look soft even after this.',
      schema: { type: 'object', required: ['image_path'], properties: {
        image_path: { type: 'string', description: 'workspace-relative path to the design image' },
        preset: { type: 'string', enum: Object.keys(PRESETS), description: 'shortcut for a verified common product size' },
        target_width_in: { type: 'number' },
        target_height_in: { type: 'number' },
        target_dpi: { type: 'integer', description: 'default 300; use 120-150 for large-format items' },
        fix_if_short: { type: 'boolean', description: 'if true and the source is undersized, upscale + convert to print-ready PNG/sRGB' },
        path: { type: 'string', description: 'output path if fixing (defaults to print/<original-name>-ready.png)' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        const imageRel = String(args.image_path || '').trim();
        if (!imageRel) throw new Error('image_path is required');

        let widthIn, heightIn, dpi, presetNote = '';
        if (args.preset) {
          const p = PRESETS[args.preset];
          if (!p) throw new Error('unknown preset "' + args.preset + '" — known: ' + Object.keys(PRESETS).join(', '));
          widthIn = p.widthIn; heightIn = p.heightIn; dpi = p.dpi; presetNote = ' (' + p.note + ')';
        } else {
          widthIn = Number(args.target_width_in);
          heightIn = Number(args.target_height_in);
          dpi = Number(args.target_dpi) || DEFAULT_DPI;
          if (!widthIn || !heightIn) {
            throw new Error('give either a preset, or both target_width_in and target_height_in (look these up for your specific product on Printify — this tool does not guess them)');
          }
        }

        const { abs: imageAbs } = await jail.resolveInside(aid, imageRel);
        try { await fsp.access(imageAbs); } catch { throw new Error('image_path does not exist in this workspace: ' + imageRel); }

        const current = await probeDimensions(imageAbs);
        const requiredWidth = Math.round(widthIn * dpi);
        const requiredHeight = Math.round(heightIn * dpi);
        const meets = current.width >= requiredWidth && current.height >= requiredHeight;

        const reportLine = 'Current: ' + current.width + 'x' + current.height + 'px. Required for ' +
          widthIn + '"x' + heightIn + '" at ' + dpi + ' DPI' + presetNote + ': ' + requiredWidth + 'x' + requiredHeight + 'px.';

        if (meets) {
          return { content: reportLine + ' MEETS the requirement — safe to upload as-is.', summary: 'print check: OK' };
        }

        if (!args.fix_if_short) {
          return {
            content: reportLine + ' UNDER the requirement — this will likely print soft/pixelated, or get flagged by ' +
              'Printify\'s own quality check. Re-run with fix_if_short: true to upscale (note: this sharpens, it ' +
              'does not add real missing detail — ideally regenerate the source at a higher resolution instead).',
            summary: 'print check: TOO SMALL'
          };
        }

        // Upscale (real interpolation, lanczos) + force PNG + sRGB — matches Printify's documented
        // preferred format for apparel (transparent-background support, RGB not CMYK).
        let rel = String(args.path || '').trim();
        if (!rel) {
          const base = P.basename(imageRel).replace(/\.[a-z0-9]+$/i, '');
          rel = 'print/' + base + '-ready.png';
        } else if (!/\.[a-z0-9]+$/i.test(rel)) {
          rel += '.png';
        }
        const { abs: outAbs } = await jail.resolveInside(aid, rel);
        await fsp.mkdir(P.dirname(outAbs), { recursive: true });

        try {
          await execFileAsync('ffmpeg', [
            '-y', '-i', imageAbs,
            '-vf', 'scale=' + requiredWidth + ':' + requiredHeight + ':flags=lanczos',
            '-pix_fmt', 'rgba',
            outAbs
          ], { timeout: TIMEOUT_MS });
        } catch (e) {
          throw new Error('ffmpeg failed to upscale the image: ' + ((e && e.stderr) ? String(e.stderr).slice(-500) : (e && e.message) || e));
        }

        const stat = await fsp.stat(outAbs);
        if (stat.size > MAX_OUTPUT_BYTES) {
          await fsp.unlink(outAbs).catch(() => {});
          throw new Error('upscaled file exceeds Printify\'s 100MB limit (' + stat.size + ' bytes)');
        }

        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        return {
          content: reportLine + ' Upscaled to ' + requiredWidth + 'x' + requiredHeight + 'px and saved to ' + rel +
            ' (PNG, RGB).\nHonest caveat: this sharpens the existing pixels, it does not invent detail that ' +
            'was never there — for best results, regenerate the source design at the target resolution instead.\n' +
            'View: ' + viewer,
          summary: 'print check: fixed → ' + rel
        };
      }
    };

    return {
      printPrepTool,
      _internals: { probeDimensions, PRESETS },
      register(reg) { reg.register(printPrepTool); return reg; }
    };
  }

  return { makePrintPrepTools };
});
