/* SPACESTATION — windows/intelligence.js : the INTELLIGENCE window slot (Business OS Phase 7).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — the trend rows, the P1 explanation rendering, the
   portfolio aggregation, the model router form and the cost recommendations — lives in
   app/businessintelligence.js so it stays Node-testable; the <script> order in index.html loads the engine
   first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads INTELLIGENCE,
   this registers 'INTELLIGENCE', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildIntelligence(body) {
    if (typeof BusinessIntelligenceConsole === 'undefined' || typeof BusinessIntelligenceConsole.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "nothing moved".
      body.innerHTML = '<p class="in-empty">The Intelligence engine did not load — check that ' +
        '<b>app/businessintelligence.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessIntelligenceConsole.mount(body);
  }

  StationUI.registerWindow('intelligence', 'INTELLIGENCE', buildIntelligence, { console: true });
})();
