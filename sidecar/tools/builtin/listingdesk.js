/* sidecar/tools/builtin/listingdesk.js — the LISTING DESK capability: etsy_listing_check(title, tags, image).
   New capability, same gap-filling role as printprep.js: Etsy is wired as generic REST access (see
   servicekeys-catalog.js) with no domain-specific validation. Nothing currently catches a listing
   that violates Etsy's own hard limits before it gets published.

   Deliberately checks ONLY objective, documented, mechanical rules — title/tag length limits, tag
   count, image pixel/size/format requirements. It does NOT judge whether keywords are good SEO or
   whether copy is compelling — that's real creative/strategic judgment that belongs to the agent
   writing the listing, not something a tool should fake. Same division of labor as printprep.js:
   code checks what's checkable, the agent decides what's good.

   Numbers verified against Etsy's own current documentation (cross-checked across several
   independent seller guides, all agreeing): title max 140 chars, exactly ≤13 tags, each tag
   max 20 chars, tags shouldn't just repeat title words, images ≥2000px on the shortest side
   (optimal 2000x2000 square), ≤10MB, JPG/PNG/GIF only.

   Reuses ffmpeg/ffprobe for image checks, same as printprep.js and compose.js — no new dependency.

   makeListingDeskTools({ fsp, pathMod, root, execFileImpl? }) -> { checkTool, register(reg), _internals }

   Node 18+. Reuses the fs.js workspace jail, same as every sibling tool. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).listingdesk = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');

  const TITLE_MAX = 140;
  const TAG_MAX_COUNT = 13;
  const TAG_MAX_CHARS = 20;
  const IMAGE_MIN_SHORT_SIDE = 2000;
  const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  const VALID_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif'];

  function makeListingDeskTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('listingdesk.js requires { fsp, pathMod, root }');
    const execFileAsync = deps.execFileImpl ? promisify(deps.execFileImpl) : promisify(execFile);
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    async function probeImage(absPath) {
      const res = await execFileAsync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', absPath
      ], { timeout: 15000 });
      const m = /^(\d+)x(\d+)/.exec(String(res.stdout).trim());
      if (!m) throw new Error('could not read image dimensions from: ' + absPath);
      return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
    }

    function tagRepeatsTitle(tag, titleWords) {
      const tagWords = tag.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tagWords.length) return false;
      return tagWords.every(w => titleWords.has(w));
    }

    const checkTool = {
      name: 'etsy_listing_check', capability: 'listingdesk', scope: 'read', requiresConsent: false, timeoutMs: 20000,
      description: 'Check a proposed Etsy listing (title, tags, optionally an image) against Etsy\'s actual documented ' +
        'hard limits BEFORE publishing: title ≤140 chars, exactly ≤13 tags, each tag ≤20 chars and not just repeating ' +
        'title words, image ≥2000px on its shortest side and ≤10MB in JPG/PNG/GIF. This only checks mechanical rules — ' +
        'it does NOT judge whether your keywords are good SEO or your copy is compelling; that\'s your call.',
      schema: { type: 'object', required: ['title', 'tags'], properties: {
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        image_path: { type: 'string', description: 'optional workspace-relative path to the listing photo to check' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        const title = String(args.title || '');
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const issues = [];
        const ok = [];

        if (!title.trim()) issues.push('Title is empty.');
        else if (title.length > TITLE_MAX) issues.push('Title is ' + title.length + ' chars — over the ' + TITLE_MAX + ' char limit by ' + (title.length - TITLE_MAX) + '.');
        else ok.push('Title length OK (' + title.length + '/' + TITLE_MAX + ' chars).');

        if (!tags.length) issues.push('No tags given — Etsy allows up to ' + TAG_MAX_COUNT + '; using all of them is standard practice.');
        else {
          if (tags.length > TAG_MAX_COUNT) issues.push('You gave ' + tags.length + ' tags — only the first ' + TAG_MAX_COUNT + ' are usable, the rest will be rejected/ignored.');
          else if (tags.length < TAG_MAX_COUNT) ok.push('Using ' + tags.length + '/' + TAG_MAX_COUNT + ' tag slots — consider filling all ' + TAG_MAX_COUNT + ' for max reach.');
          else ok.push('Using all ' + TAG_MAX_COUNT + ' tag slots.');

          const overLong = tags.filter(t => t.length > TAG_MAX_CHARS);
          if (overLong.length) issues.push('Tag(s) over ' + TAG_MAX_CHARS + ' chars: ' + overLong.map(t => '"' + t + '" (' + t.length + ')').join(', ') + '.');

          const titleWords = new Set(title.toLowerCase().split(/\s+/).filter(Boolean));
          const repeats = tags.filter(t => tagRepeatsTitle(t, titleWords));
          if (repeats.length) issues.push('Tag(s) just repeat title words instead of covering new search terms: ' + repeats.map(t => '"' + t + '"').join(', ') + '.');
        }

        if (args.image_path) {
          const imageRel = String(args.image_path);
          const { abs: imageAbs } = await jail.resolveInside(aid, imageRel);
          try { await fsp.access(imageAbs); } catch { throw new Error('image_path does not exist in this workspace: ' + imageRel); }

          const ext = P.extname(imageRel).toLowerCase();
          if (!VALID_IMAGE_EXT.includes(ext)) issues.push('Image format "' + ext + '" is not one of JPG/PNG/GIF.');

          const stat = await fsp.stat(imageAbs);
          if (stat.size > IMAGE_MAX_BYTES) issues.push('Image is ' + (stat.size / 1024 / 1024).toFixed(1) + 'MB — over the 10MB limit.');
          else ok.push('Image file size OK (' + (stat.size / 1024 / 1024).toFixed(1) + 'MB).');

          const dims = await probeImage(imageAbs);
          const shortSide = Math.min(dims.width, dims.height);
          if (shortSide < IMAGE_MIN_SHORT_SIDE) {
            issues.push('Image is ' + dims.width + 'x' + dims.height + 'px — shortest side (' + shortSide + 'px) is under the ' +
              IMAGE_MIN_SHORT_SIDE + 'px minimum; will be demoted in search or need re-upload.');
          } else {
            ok.push('Image dimensions OK (' + dims.width + 'x' + dims.height + 'px).');
          }
        }

        const verdict = issues.length ? 'ISSUES FOUND' : 'READY TO PUBLISH';
        let content = verdict + '\n\n';
        if (issues.length) content += 'Fix before publishing:\n' + issues.map(i => '✗ ' + i).join('\n') + '\n\n';
        if (ok.length) content += 'Passing checks:\n' + ok.map(o => '✓ ' + o).join('\n');

        return { content: content.trim(), summary: 'listing check: ' + verdict + (issues.length ? ' (' + issues.length + ')' : '') };
      }
    };

    return {
      checkTool,
      _internals: { tagRepeatsTitle, probeImage },
      register(reg) { reg.register(checkTool); return reg; }
    };
  }

  return { makeListingDeskTools };
});
