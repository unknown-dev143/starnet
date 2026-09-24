/* sidecar/tools/builtin/briefing.js — the BRIEFING ROOM capability: report_publish(type, summary, ...).
   New capability, inspired by (not copied from — that project's license doesn't permit copying)
   a "morning brief / evening digest" pattern seen in another local AI assistant project. Formats
   and saves a clean, dated status report — morning (health + top priorities) or evening (recap of
   what happened) — as a markdown file in your workspace.

   Deliberately thin: this tool does NOT gather "what happened" itself — that reasoning belongs to
   the agent, which already has access to the skill library, todo list, and its own memory. This
   tool's only job is taking that content and saving it as a clean, consistently-formatted,
   dated report, same division of labor as doc_publish (agent writes, tool formats+saves).

   Pairs with StarNet's existing routines.js scheduling — set up a routine to run this at 8am and
   7pm rather than building a second scheduler here.

   makeBriefingTools({ fsp, pathMod, root, now }) -> { reportTool, register(reg), _internals }

   `now` is an INJECTED clock (a () => Date). The report date/time must come from it, never from an ambient
   `new Date()` — backend logic may not touch ambient time (test/lint-determinism.js), and the composition
   root (sidecar/index.js) is the one place allowed to construct a real Date.

   Node 18+. No dependencies. Reuses the fs.js workspace jail, same as every sibling tool. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./fs.js'));
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).briefing = factory(root.SK.tools.builtin.fs); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fsMod) {
  'use strict';

  const MAX_ITEMS = 30;

  function makeBriefingTools(deps) {
    deps = deps || {};
    const fsp = deps.fsp, P = deps.pathMod, ROOT = deps.root, now = deps.now;
    if (!fsp || !P || !ROOT) throw new Error('briefing.js requires { fsp, pathMod, root }');
    if (typeof now !== 'function') throw new Error('briefing.js requires { now } — an injected clock; ambient time is banned by lint-determinism');
    const jail = fsMod.makeFsTools({ fsp, pathMod: P, root: ROOT })._internals;

    function emitDeliverable(ctx, aid, rel) {
      if (!ctx || typeof ctx.emit !== 'function') return;
      const d = { id: 'report_' + String(rel).replace(/[^A-Za-z0-9_.-]/g, '_'), agentId: aid, kind: 'report', title: String(rel) };
      if (ctx.room) d.room = ctx.room;
      ctx.emit('deliverable', d);
    }

    function mdList(items) {
      return (items || []).slice(0, MAX_ITEMS).map(i => '- ' + String(i).trim()).join('\n');
    }

    // ---------------- report_publish ----------------
    const reportTool = {
      name: 'report_publish', capability: 'briefingroom', scope: 'write', requiresConsent: false, timeoutMs: 15000,
      description: 'Save a morning or evening status report as a dated markdown file. For type "morning": give a ' +
        'one-line health/status summary and a short list of top priorities for the day (2-4 items, most important ' +
        'first). For type "evening": give a one-line summary of the day and a list of what actually happened ' +
        '(completed tasks, notable events, anything worth remembering tomorrow). You decide the actual content — ' +
        'this tool only formats and saves it. One report per day per type; calling it again the same day overwrites.',
      schema: { type: 'object', required: ['type', 'summary'], properties: {
        type: { type: 'string', enum: ['morning', 'evening'] },
        summary: { type: 'string', description: 'one or two sentence overall summary' },
        priorities: { type: 'array', items: { type: 'string' }, description: 'morning: top things to focus on today' },
        highlights: { type: 'array', items: { type: 'string' }, description: 'evening: what actually happened' },
        notes: { type: 'string', description: 'optional freeform additional detail' }
      } },
      run: async (args, ctx) => {
        const aid = (ctx && ctx.agentId) || 'agent';
        const type = String(args.type || '').trim();
        if (type !== 'morning' && type !== 'evening') throw new Error('type must be "morning" or "evening"');
        const summary = String(args.summary || '').trim();
        if (!summary) throw new Error('summary is required');

        const at = now();   // INJECTED clock — never an ambient new Date() (lint-determinism)
        const dateStr = at.toISOString().slice(0, 10);
        const timeStr = at.toTimeString().slice(0, 5);

        let md = '# ' + (type === 'morning' ? 'Morning Brief' : 'Evening Digest') + ' — ' + dateStr + '\n\n';
        md += '_' + timeStr + '_\n\n';
        md += summary + '\n\n';

        if (type === 'morning') {
          const priorities = Array.isArray(args.priorities) ? args.priorities : [];
          if (priorities.length) {
            md += '## Today\'s priorities\n\n' + mdList(priorities) + '\n\n';
          }
        } else {
          const highlights = Array.isArray(args.highlights) ? args.highlights : [];
          if (highlights.length) {
            md += '## What happened\n\n' + mdList(highlights) + '\n\n';
          }
        }

        if (args.notes) {
          md += '## Notes\n\n' + String(args.notes).trim() + '\n';
        }

        const rel = 'reports/' + type + '-' + dateStr + '.md';
        const { abs } = await jail.resolveInside(aid, rel);
        await fsp.mkdir(P.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, md, 'utf8');

        emitDeliverable(ctx, aid, rel);
        const viewer = '/api/file?agent=' + encodeURIComponent(aid) + '&path=' + encodeURIComponent(rel);
        return {
          content: 'Saved ' + type + ' report to ' + rel + '.\nView: ' + viewer,
          summary: 'report → ' + rel
        };
      }
    };

    return {
      reportTool,
      _internals: { mdList },
      register(reg) { reg.register(reportTool); return reg; }
    };
  }

  return { makeBriefingTools };
});
