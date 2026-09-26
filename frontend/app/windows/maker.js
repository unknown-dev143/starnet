/* SPACESTATION — windows/maker.js : the BUSINESS MAKER window slot (Business OS Phase 2).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — pure row shaping + the console mount — lives in
   app/businessmaker.js so it stays Node-testable; the <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads BUSINESS MAKER,
   this registers 'BUSINESS MAKER', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildMaker(body) {
    if (typeof BusinessMaker === 'undefined' || typeof BusinessMaker.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "you have no opportunities".
      body.innerHTML = '<p class="bm-empty">The Business Maker engine did not load — check that ' +
        '<b>app/businessmaker.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessMaker.mount(body);
  }

  StationUI.registerWindow('maker', 'BUSINESS MAKER', buildMaker, { console: true });
})();
