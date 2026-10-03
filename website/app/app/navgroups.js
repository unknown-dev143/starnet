/* SPACESTATION — navgroups.js : the CONCEPTUAL information architecture (brief §5).

   WHY THIS EXISTS
     The station's bottom dock is organised for REACHING things fast: four physical docks
     (CREW / WORK / BUILD / SYSTEM — the `.bb-group[data-group]` triggers in index.html), each a
     popover of window buttons. That layout is governed by hard laws (LABEL LAW; data-group keys
     are internal and never renamed — navdock/dockglow/tutorial select on them).

     The MASTER BRIEF (46 sections, "AI COMMAND CENTER") names a DIFFERENT, higher-level set of
     fifteen surfaces (§5): COMMAND CENTER · MISSIONS · CREATION LAB · BUSINESSES · PORTFOLIO ·
     WORKFORCE · CREATOR STUDIO · OPPORTUNITY RADAR · EXPERIMENT LAB · AUTOMATION · INTELLIGENCE ·
     MEMORY · ANALYTICS · SECURITY · TERMINAL.

     Almost every one of those is ALREADY BUILT — it just wears a different label. This file is the
     single, declarative bridge: it maps each §5 label onto the REAL window key(s) that already
     implement it, so the brief's IA is legible in the source WITHOUT moving a single module and
     WITHOUT disturbing the four physical docks (Step A of docs/PHASE0-AUDIT-v4.md §8 — "no module
     moves").

   CONTRACT (so it stays honest and testable — mirror of worldmodel.js's purity note):
     - Pure data + pure functions. No DOM, no window, no clock, no RNG.
     - `windows` lists REAL window keys (the `data-term` / registerWindow keys). A label with no
       window yet is declared `pending: true` naming the surface it is owed — never a fabricated key.
     - `test/nav-groups.test.js` reads frontend/index.html + frontend/app/stationui.js +
       frontend/app/windows/*.js and asserts every key here EXISTS, and every dock window is claimed
       by at least one label. Drift in either direction fails BY NAME. */
'use strict';

const NavGroups = (() => {
  /* THE TABLE. One entry per brief §5 label.
       id      — stable slug (used by openTerm-compatible deep links / future tiles).
       label   — the §5 display name, verbatim (uppercase).
       dock    — the physical dock it lives under today (crew|work|build|system), or null if it has
                 no dock home yet (a gap). Never invents a data-group key.
       windows — the REAL window key(s) that implement this surface. [] ⇔ pending.
       pending — true when the label has no dedicated window yet (recorded gap; see audit §6).
       note    — one honest line: where the surface actually lives. */
  const GROUPS = [
    { id: 'command-center', label: 'COMMAND CENTER', dock: 'work',
      windows: ['mission', 'tasks'],
      note: 'The attention-first home: MISSION CONTROL ranks what blocks you, TASK BOARD holds live work.' },

    { id: 'missions', label: 'MISSIONS', dock: 'work',
      windows: ['mission', 'tasks'],
      note: 'Mission engine (mission-control.js + /api/mission/*) surfaced through MISSION CONTROL + TASKS.' },

    { id: 'creation-lab', label: 'CREATION LAB', dock: 'work',
      windows: ['maker', 'factory'],
      note: 'Turn an idea into a plan: BUSINESS MAKER (validate) → SOFTWARE FACTORY (idea→operating).' },

    { id: 'businesses', label: 'BUSINESSES', dock: 'work',
      windows: ['business', 'manager'],
      note: 'BUSINESS is the list + audit log; BUSINESS MANAGER is where a business is run.' },

    { id: 'portfolio', label: 'PORTFOLIO', dock: 'work',
      windows: ['intelligence'],
      section: 'portfolio',
      note: 'Cross-business read via /api/intelligence/portfolio, shown in INTELLIGENCE.' },

    { id: 'workforce', label: 'WORKFORCE', dock: 'crew',
      windows: ['team', 'worker', 'agents'],
      note: 'AI TEAM hires/assigns roles; WORKER is an agent doing real work; AGENTS holds each dossier.' },

    { id: 'creator-studio', label: 'CREATOR STUDIO', dock: 'work',
      windows: ['creatorstudio', 'manager'],
      note: 'The §17 content pipeline (business-content-store.js) across every business — the dedicated surface (Step C) with PIPELINE · CALENDAR · CREATIONS (the §37 unified index), plus the per-business CONTENT tab in BUSINESS MANAGER.' },

    { id: 'opportunity-radar', label: 'OPPORTUNITY RADAR', dock: 'work',
      windows: ['maker'],
      note: 'opportunities-store.js + /api/opportunities*, presented by BUSINESS MAKER.' },

    { id: 'experiment-lab', label: 'EXPERIMENT LAB', dock: 'work',
      windows: ['manager'],
      section: 'experiments',
      note: 'business-experiments-store.js, presented in BUSINESS MANAGER ▸ EXPERIMENTS.' },

    { id: 'automation', label: 'AUTOMATION', dock: 'work',
      windows: ['automation'],
      note: 'Routines (when) + loops (until done) — any job on a schedule or repeated to completion.' },

    { id: 'intelligence', label: 'INTELLIGENCE', dock: 'work',
      windows: ['intelligence', 'digitaltwin'],
      note: 'What the numbers say (INTELLIGENCE) + what-ifs on real readings (DIGITAL TWIN).' },

    { id: 'memory', label: 'MEMORY', dock: 'crew',
      windows: ['agents', 'commander'],
      note: 'Per-agent record/memory (AGENTS ▸ dossier) + what the station knows about you (COMMANDER).' },

    { id: 'analytics', label: 'ANALYTICS', dock: 'work',
      windows: ['intelligence'],
      section: 'analytics',
      note: 'business-metrics.js / business-finance.js surfaced through INTELLIGENCE and MANAGER ▸ ANALYTICS.' },

    { id: 'security', label: 'SECURITY', dock: 'work',
      windows: ['security'],
      note: 'Tiers, grants, recent authority decisions and what awaits you — the read of authority.' },

    { id: 'terminal', label: 'TERMINAL', dock: null,
      windows: [],
      pending: true,
      note: 'Owed: a first-class terminal surface. Today it is a tool (tools/builtin/terminal.js) + the floating .term window, reachable through WORKER — no dock door yet.' }
  ];

  // The physical docks (index.html .bb-group[data-group]) — the §5 labels are mapped ONTO these, they do
  // not replace them. Listed here so a test can assert every §5 dock claim names a real dock.
  const DOCKS = ['crew', 'work', 'build', 'system'];

  /* UTILITY WINDOWS — real dock doors that deliberately sit OUTSIDE the brief's §5 product IA.
     The brief names fifteen *product* surfaces; the dock also carries plumbing that no §5 label should
     claim (an update checker is not a "Mission"): DELIVERABLES, GOAL AUTOPILOT, QUESTS, ABILITIES
     (connectors), CHANNELS (messaging), FIELD MANUAL, SETTINGS, UPDATES, NOTIFICATIONS. Listing them
     EXPLICITLY — rather than loosening the test — is the point: a NEW dock window must be either claimed
     by a §5 label or added here on purpose, and either way the drift fails by name. Never add a key here
     to silence a genuine IA gap; that is what a `pending` label is for. */
  const UTILITY = [
    'deliverables', 'autopilot', 'quests', 'connectors', 'messaging', 'manual', 'settings', 'updates', 'notifs'
  ];

  const byId = {}; GROUPS.forEach(g => { byId[g.id] = g; });
  // window key -> the §5 labels that claim it (a window may serve more than one label).
  const byWindow = {}; GROUPS.forEach(g => (g.windows || []).forEach(w => { (byWindow[w] || (byWindow[w] = [])).push(g.label); }));

  return {
    DOCKS,
    UTILITY,
    all: () => GROUPS.slice(),
    ids: () => GROUPS.map(g => g.id),
    labels: () => GROUPS.map(g => g.label),
    byId: id => byId[id] || null,
    // the §5 label(s) a real window key implements; [] if the window is not in the IA table yet.
    labelsFor: key => (byWindow[key] || []).slice(),
    // every REAL window key the table claims.
    windowKeys: () => Object.keys(byWindow).sort(),
    // labels with no dedicated window (declared gaps) — Step C/D targets.
    pendingLabels: () => GROUPS.filter(g => g.pending).map(g => g.label),
    // resolve a §5 label (by id or display label, case-insensitive) → its entry, or null.
    resolve: name => {
      const q = String(name == null ? '' : name).trim().toLowerCase();
      return GROUPS.find(g => g.id === q || g.label.toLowerCase() === q) || null;
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NavGroups;
