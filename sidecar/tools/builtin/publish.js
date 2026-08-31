/* sidecar/tools/builtin/publish.js — the PUBLISHING HOUSE capability: doc_publish(title, sections).
   New capability, filling a real gap: docextract.js reads documents IN (docx/xlsx/notebook -> text),
   but nothing generates a finished, formatted document OUT. This is that missing step — turning
   structured written content (chapters, sections, headings) into a real .docx file, the same
   "generate -> save into the jailed workspace -> emit deliverable" pattern as every other tool here.

   Uses the "docx" npm package (a genuine, actively maintained OOXML generator — this is the first
   BUNDLED npm dependency added to this fork; every other new tool so far used only Node built-ins
   or a local system binary like ffmpeg). No network call, no API key, no cost — pure local
   document assembly.

   makeDocTools({ fsp, pathMod, root }) -> { publishTool, register(reg), _internals }

   Node 18+. Reuses the fs.js workspace jail, same as every sibling tool. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).publish = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50MB safety cap
  const MAX_SECTIONS = 200;

  function makeDocTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root;
    if (!fsp || !P || !ROOT) throw new Error('publish.js requires { fsp, pathMod, root }');
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    let docxLib;
    function getDocx() {
      if (!docxLib) {
        try {
          docxLib = require('docx');
        } catch (e) {
          throw new Error('PUBLISHING HOUSE needs the "docx" package installed (run npm install in the app folder) — ' + e.message);
        }
      }
      return docxLib;
    }

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'doc_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'document', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    // Splits a section's body into paragraphs on blank lines, so multi-paragraph body text renders
    // as separate <w:p> elements instead of one run-on block — the one bit of structure worth
    // inferring automatically rather than asking the caller to pre-split everything.
    function bodyToParagraphs(Paragraph, TextRun, body) {
      const text = String(body || '');
      return text.split(/\n\s*\n/).filter(p => p.trim()).map(
        (p) => new Paragraph({ children: [new TextRun(p.trim().replace(/\n/g, ' '))] })
      );
    }

    // ---------------- doc_publish ----------------
    const publishTool = {
      name: 'doc_publish', capability: 'publishinghouse', scope: 'write', requiresConsent: true, timeoutMs: 30000,
      description: 'Assemble structured written content (a title plus an ordered list of sections, each with a ' +
        'heading and body text) into a real, finished .docx file, saved into your workspace. Use this once the ' +
        'actual writing is done and you want a real deliverable document — not for drafting the text itself, ' +
        'which is just ordinary chat output. Good for book chapters, reports, scripts — anything with a title ' +
        'and a sequence of headed sections.',
      schema: { type: 'object', required: ['title', 'sections'], properties: {
        title: { type: 'string' },
        author: { type: 'string', description: 'optional author name for the title page' },
        sections: {
          type: 'array', minItems: 1, maxItems: MAX_SECTIONS,
          items: { type: 'object', required: ['heading', 'body'], properties: {
            heading: { type: 'string' },
            body: { type: 'string', description: 'plain text; blank lines separate paragraphs' }
          } }
        },
        path: { type: 'string', description: 'output filename (defaults to docs/<title-slug>.docx)' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        const title = String(args.title || '').trim();
        if (!title) throw new Error('title is required');
        const sections = Array.isArray(args.sections) ? args.sections : [];
        if (!sections.length) throw new Error('sections must be a non-empty array of { heading, body }');
        if (sections.length > MAX_SECTIONS) throw new Error('too many sections (max ' + MAX_SECTIONS + ')');
        for (const [i, s] of sections.entries()) {
          if (!s || typeof s.heading !== 'string' || typeof s.body !== 'string') {
            throw new Error('sections[' + i + '] must have a string "heading" and string "body"');
          }
        }

        const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = getDocx();

        const children = [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 56 })],
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
        ];
        if (args.author) {
          children.push(new Paragraph({
            children: [new TextRun({ text: String(args.author), italics: true, size: 24 })],
            alignment: AlignmentType.CENTER,
          }));
        }
        for (const s of sections) {
          children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
          children.push(...bodyToParagraphs(Paragraph, TextRun, s.body));
        }

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);

        if (buffer.length > MAX_OUTPUT_BYTES) {
          throw new Error('assembled document too large (' + buffer.length + ' bytes)');
        }

        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
        let rel = String(args.path || '').trim();
        if (rel) { if (!/\.[a-z0-9]+$/i.test(rel)) rel += '.docx'; }
        else { rel = 'docs/' + slug + '.docx'; }

        const { abs } = await jail.resolveInside(aid, rel);
        await fsp.mkdir(P.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buffer);

        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        const kb = (buffer.length / 1024).toFixed(0) + ' KB';
        return {
          content: 'Published "' + title + '" (' + sections.length + ' section' + (sections.length === 1 ? '' : 's') +
            ', ' + kb + ') to ' + rel + '.\nView: ' + viewer,
          summary: 'document → ' + rel
        };
      }
    };

    return {
      publishTool,
      _internals: { bodyToParagraphs },
      register(reg) { reg.register(publishTool); return reg; }
    };
  }

  return { makeDocTools };
});
