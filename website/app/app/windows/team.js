/* SPACESTATION — windows/team.js : the AI TEAM window slot (Business OS Phase 3).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — pure row shaping + the console mount — lives in
   app/aiteam.js so it stays Node-testable; the <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads AI TEAM, this
   registers 'AI TEAM', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildTeam(body) {
    if (typeof AITeam === 'undefined' || typeof AITeam.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "you have hired nobody".
      body.innerHTML = '<p class="tm-empty">The AI Team engine did not load — check that ' +
        '<b>app/aiteam.js</b> is loaded by index.html.</p>';
      return;
    }
    AITeam.mount(body);
  }

  StationUI.registerWindow('team', 'AI TEAM', buildTeam, { console: true });
})();
