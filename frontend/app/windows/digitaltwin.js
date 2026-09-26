/* STARNET — windows/digitaltwin.js : the DIGITAL TWIN window slot (Business OS Phase 9, §18).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — the what-if form, the simulated-vs-recorded
   table, the SIM markers and the comparison — lives in app/businessdtwin.js so it stays Node-testable; the
   <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads DIGITAL TWIN,
   this registers 'DIGITAL TWIN', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildDigitalTwin(body) {
    if (typeof BusinessDTwin === 'undefined' || typeof BusinessDTwin.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "there is nothing to simulate".
      body.innerHTML = '<p class="dt-empty">The Digital Twin engine did not load — check that ' +
        '<b>app/businessdtwin.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessDTwin.mount(body);
  }

  StationUI.registerWindow('digitaltwin', 'DIGITAL TWIN', buildDigitalTwin, { console: true });
})();
