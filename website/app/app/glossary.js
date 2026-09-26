/* STARNET — glossary.js : the one place the station explains its own words to a first-minute user.

   A pure term -> one-sentence map, consumed by hint.js (data-hint="<term>" tooltips). Copy law:
   lowercase station voice, eerie-not-cute, one plain sentence a beginner can act on. Every entry
   is grounded in how the term is ACTUALLY used in the code (marketplace.js / autonomy.js / stationui.js
   / returnstore.js) — not an aspirational definition. Keys are lowercased on lookup, so
   data-hint="REFIT" and data-hint="refit" resolve the same entry.

   UMD: a `Glossary` global in the browser; module.exports under node/tests. No DOM, no deps. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.Glossary = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // term -> one beginner-facing sentence. Keep each to a single sentence; no jargon inside the definition.
  const TERMS = {
    agent:        'one working AI identity with its own model, chat, workspace, memory, and run history.',
    crew:         'all agents currently on your station — each keeps its own identity and work.',
    model:        'the AI engine an agent uses to think and answer; you can change it per agent.',
    effort:       'the reasoning depth used for a run — higher effort may think longer and cost more.',
    voice:        'the speaking style and personality an agent uses; it does not change its authority.',
    focus:        'the kind of work an agent is configured to prioritize, such as code, research, or operations.',
    provider:     'the service that supplies a model, such as OpenRouter, OpenAI, Anthropic, or a local server.',
    run:          'one bounded attempt to finish a message or task, with its own stop, cost, and result.',
    approval:     'your explicit yes or no before a watched agent — or an automation — performs a sensitive action. Each request carries what it wants to do, why it fired and the evidence behind it; a decision is final.',
    transcript:   'the durable conversation record for one chat thread, including what happened after restarts.',
    deliverable:  'a finished file or output from real work — open it from DELIVERABLES to inspect the result.',
    artifact:     'a file produced or checked by a run, recorded with its path and verification evidence.',
    verification: 'a fresh check performed after the work changed, so completion is proved instead of claimed.',
    context:      'the conversation and evidence currently visible to the model; older material can be compacted safely.',
    fallback:     'the next configured model or credential tried when the current provider cannot continue.',
    settings:     'the station controls for providers, models, voice, budget, permissions, and saved data.',
    update:       'a new StarNet build; the UPDATES panel shows the version and its verified delivery state.',
    restore:      'return an agent’s workspace files to a saved restore point without rewriting unrelated station data.',
    logbook:      'this agent’s durable run history — what ran, how it ended, and what it cost.',
    notification: 'a station alert about work, failure, delivery, or another event that needs your attention.',
    manual:       'the reopenable guide to first steps, the real work loop, gear, wiring, and growth.',
    commander:    'you — the person who directs the station, grants authority, and judges its work.',
    work:         'tasks, deliverables, recipes, routines, loops, and quests gathered under one dock.',
    build:        'the dock for equipping agents, shaping the floor, and connecting outside abilities.',
    system:       'the dock for the manual, settings, updates, restore points, history, and alerts.',
    workstream:   'the saved conversation behind a COMMS session; planned task conversations also appear as cards on the TASK BOARD.',
    orchestrator: 'the lead agent you talk to first — new agents inherit its model unless you pick another.',
    overseer:     'the station itself — it holds shared gear that any specialist can draw on.',
    refit:        'the station’s build mode — open it from the dock to place desks, furniture, and gear.',
    clearance:    'how hard the agent’s model thinks — more diamonds mean deeper (slower) reasoning.',
    lane:         'the kind of work a class is built for: CODE, RESEARCH, or general OPS.',
    dish:         'the WEB gear — with it on station, an agent can search and fetch live pages.',
    cabinet:      'the FILES gear — with it on station, an agent can read, write, and search your workspace.',
    notebook:     'the MEMORY gear — a durable notebook the agent can save to and recall later.',
    workbench:    'the TERMINAL gear — lets an agent run and test real code (each run asks you first).',
    studio:       'the IMAGES gear — lets an agent generate and read visuals.',
    seed:         'a saved idea you can hand back to an agent later so it picks up right where you left off.',
    drafted:      'written up by the station for you to review — nothing is summoned until you confirm it.',
    sidecar:      'the small local program that actually runs your agents — the app talks to it in the background.',
    // the WORK vocabulary, each on ONE axis (UX confusion audit 2026-07-15: recipe=WHAT to run,
    // routine=WHEN it runs, task=WHERE live work sits, quest=progress/suggestions — never a place work lives).
    automation:   'the home of standing work — ROUTINES (any job on a schedule), LOOPS (one objective, repeated until it’s done) and BUSINESS RULES (when something happens in a business, do this) share this one panel. A business rule only ever touches its own business, and anything that reaches outside the station waits for your yes.',
    routine:      'a recipe or job put on a schedule (every morning, hourly) — WHEN work runs; manage them under ∞ AUTOMATION.',
    loop:         'one objective an agent keeps working at, stopping each time for your yes or no — UNTIL it is done, not on a clock. Your verdict is what starts the next pass; it costs nothing while it waits. Manage them under ∞ AUTOMATION.',
    recipe:       'a ready-made job an agent can run right now — WHAT to run; launching one lands it on the ☑ TASK BOARD.',
    /* Business OS (Phase 6). The WORKER is described by what it can and cannot reach, because that is the
       question a user actually has: this is the one console an agent does real station work from. */
    worker:       'a work order — an agent doing real station work (reading and writing files, searching the web, keeping notes) for one business. Each step carries two verdicts: the §13 TIER of what the action means, and the runtime FLOOR of what the tool does to your machine. Both must be satisfied, so a harmless-looking action whose tool writes still stops for a person. Planning an order does not run it; RUN is a separate press.',
    workorder:    'one job you hand the WORKER: an intent in words plus a list of tool steps, each with a reason. Its status is worked out from what the steps actually did — an order is only DONE when every step ran, PARTIAL when some did, and BLOCKED while one waits on you.',
    floor:        'the runtime’s own requirement for what a tool does to your machine, read from the tool’s declaration — READ / WRITE / EXECUTE. It is separate from the §13 tier: a safe action whose tool writes is still held, because the two systems judge different things.',
    /* Business OS (Phase 7). INTELLIGENCE is described by what it will NOT do, because that is the whole
       design: it explains, it never decides. A user asking "why did revenue drop" needs to know the answer
       is a candidate, not a verdict. */
    intelligence: 'where the station says what it actually knows about your businesses: which numbers moved, what else was recorded at the same time, which models cost what, and where a cheaper one could have done the job. It reads only — nothing here changes a metric, a model or a setting. When it cannot explain a change it says so rather than inventing a reason.',
    signal:       'a condition the numbers actually show — a figure moving the same way four readings running, a reading far outside its own normal range, an experiment that ended with no verdict recorded. A signal is an observation, never a recommendation: what you do about it stays yours.',
    portfolio:    'every business side by side on one metric. A business that never recorded a number is shown as MISSING, not as zero — so a total is the sum of what was really reported, and the count next to it says how many businesses that covers.',
    /* Business OS (Phase 9, §18). DIGITAL TWIN is the one place the station shows a number that is NOT a
       measurement, so its copy has to do the work of stopping it being read as one. */
    digitaltwin:  'a what-if on your own recorded numbers: name an assumption (say "conversion ×1.2") and see what the figures you actually recorded would have been. It is arithmetic, not a forecast — every simulated figure carries a SIM marker and the recorded value it came from, nothing is dated in the future, and a metric you never recorded cannot be simulated at all. Nothing you do here changes any real number.',
    securitycenter: 'one read of who can do what in a business: every action and the tier it sits in, the grants each hired seat actually holds, the recent decisions that were about authority, and how many approvals are waiting on you. It shows what is recorded and no score or grade — nothing can be changed from here, because granting and approving have their own places. "Held by nobody" is a statement, and a source that could not be read says so rather than showing a zero.',
    missioncontrol: 'everything you are running on one board, ordered by what is blocking it: work waiting on your decision first, then anything that is not operating (paused, winding down, archived), then anything that has gone quiet — and each row says the reasons it sits where it does, so the order is never a mystery. There is no score or health rating here; the reasons ARE the ranking. Nothing can be changed from this view, and a business with nothing wrong simply reads as quiet.',
    autopilot:    'one stated objective becomes the whole plan at once: it matches your words against the goals it actually knows, shows the plan and the exact words that matched, and only writes the tasks into a business when you commit them. The goal set is closed on purpose — an objective it does not know is refused with the list of ones it does, because a plan invented for you is one you would act on.',
    softwarefactory: 'the whole journey from an idea to a running business, one honest read at a time: each stage shows reached only when a recorded fact proves it, says what is blocking it when it cannot have happened yet, and shows "cannot tell" rather than a zero when the source that would prove it could not be read. There is no progress bar — a percentage here would be invented, so it shows the facts instead.',
    task:         'a planned piece of work created on the board or launched from a recipe or goal — it appears on the ☑ TASK BOARD and opens as a COMMS session.',
    quest:        'a suggestion or progress marker from the station — accepting one starts real work; it is never a second to-do list.',
    // Business OS (Phase 1). The per-business stop is deliberately described as SCOPED: it is not the E-STOP,
    // and copy that blurred the two would make a user think pausing one business froze the whole station.
    business:     'a venture you run on the station — it keeps its own stage and its own activity log, and setting it to PAUSED stops its work without halting the rest of the station.',
    maker:        'where an idea becomes a business — you write down what you claim to know, label HOW you know it, try to prove yourself wrong, and only then create the business. Nothing here is scored for you; you get the counts and the labels, and you decide.',
    team:         'the agents a BUSINESS has hired — each one is one of twelve roles, filled by a real class from the catalog, with its own permission set and its own memory. Hiring one does not start it: an agent runs only safe work on its own, and asks you for everything else.',
    // Business OS (Phase 4). The MANAGER is where the business is RUN rather than made or staffed. The two
    // sentences worth spelling out are the two the console refuses to blur: real money is never added to an
    // AI guess, and a metric nobody recorded reads "not recorded" rather than 0.
    manager:      'where you run a business day to day — its money, its numbers, its customers, its content, its documents and its experiments. Every figure is kept as two separate things: what is REAL (recorded) and what the AI GUESSED (estimated), never added together; and a number nobody has recorded says so instead of showing a zero.',
    skill:        'something an agent CAN do — some skills only switch on once their gear is on station. Browse them under ⇄ ABILITIES ▸ SKILL LIBRARY.',
    toolset:      'a family of tools you can switch on or off for agents (web, files, terminal…) — the switches live in the TOOLSETS section of ⇄ ABILITIES.',
    capability:   'the same tool families as TOOLSETS, read-only — what an agent is equipped with right now; each agent’s readout is the SKILLS tab of its dossier.',
    connector:    'an outside service you plug IN so agents can use it as a tool (calendar, Slack actions, databases).',
    channel:      'your way IN from a messaging app — connect Telegram/Slack/Discord and talk to your agents from your pocket.',
    autonomy:     'how far an agent may act on its own between your messages — you set the ceiling.',
    initiative:   'whether an agent starts work on its own — the same four rungs everywhere: WAIT, SUGGEST, BUILD, FREE.',
    reach:        'the farthest a single unattended action may go — the same three rungs everywhere: OBSERVE (read only), SANDBOX (write locally), SEND & PUBLISH (contact the outside).',
    pace:         'how many small unattended jobs an agent may do per day at most.',
    xp:           'experience an agent earns from work you rate well — it levels up as it proves itself.',
    workspace:    'the folder on your machine where an agent’s files land (workspaces/<agent>/).',
    desk:         'an agent’s own workstation — it needs one placed in REFIT before it can take floor work.',
    recruit:      'summon a new agent class onto your crew, or re-spec the agent you already have.',
    slag:         'a post-mortem of a run that ended without producing anything — its cause, and the fix.',
    kudos:        'the good ratings you give an agent’s work — they raise its satisfaction and earn it XP.',
    leash:        'the cap on how many jobs an agent may do on its own before it stops and waits for you.',
    beat:         'one small unattended job the station does while you’re away — the daily limit caps how many.',
    'e-stop':     'the emergency stop — it halts every unattended job at once until you re-arm autonomy.',
    'restore point': 'a saved snapshot of an agent’s workspace you can roll it back to.',
    uplink:       'the live link to your local sidecar — full bars while telemetry flows, red when it drops.'
  };

  // lookup: case-insensitive, trims surrounding whitespace. Returns the sentence or null (caller shows nothing).
  function lookup(term) {
    if (term == null) return null;
    const key = String(term).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TERMS, key) ? TERMS[key] : null;
  }

  function has(term) { return lookup(term) != null; }

  return { TERMS, lookup, has };
});
