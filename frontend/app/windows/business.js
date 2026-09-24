/* STARNET — windows/business.js : the BUSINESS window slot (Business OS Phase 1).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — pure row shaping + the console mount — lives in
   app/businesscenter.js so it stays Node-testable; the <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads BUSINESS, this
   registers 'BUSINESS', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildBusiness(body) {
    if (typeof BusinessCenter === 'undefined' || typeof BusinessCenter.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "you have no businesses".
      body.innerHTML = '<p class="bc-empty">The Business Center engine did not load — check that ' +
        '<b>app/businesscenter.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessCenter.mount(body);
  }

  StationUI.registerWindow('business', 'BUSINESS', buildBusiness, { console: true });
})();
