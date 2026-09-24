/* STARNET — windows/manager.js : the BUSINESS MANAGER window slot (Business OS Phase 4).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — pure row shaping, the guards, the money/format
   helpers and the console mount — lives in app/businessmanager.js so it stays Node-testable; the <script>
   order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads MANAGER, this
   registers 'MANAGER', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildManager(body) {
    if (typeof BusinessManager === 'undefined' || typeof BusinessManager.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "this business has no records".
      body.innerHTML = '<p class="mg-empty">The Business Manager engine did not load — check that ' +
        '<b>app/businessmanager.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessManager.mount(body);
  }

  StationUI.registerWindow('manager', 'MANAGER', buildManager, { console: true });
})();
