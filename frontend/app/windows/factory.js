/* STARNET — windows/factory.js : the SOFTWARE FACTORY window slot (Business OS Phase 12, §22).

   The extracted-window seam stationui.js exposes: this file owns the window KEY and its title, and nothing
   else. The engine — the stage shaping, the state map and the pipeline render — lives in
   app/businessfactory.js so it stays Node-testable; the <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads SOFTWARE FACTORY,
   this registers 'SOFTWARE FACTORY', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildFactory(body) {
    if (typeof BusinessFactoryConsole === 'undefined' || typeof BusinessFactoryConsole.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "no stages yet".
      body.innerHTML = '<p class="fac-empty">The Software Factory engine did not load — check that ' +
        '<b>app/businessfactory.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessFactoryConsole.mount(body);
  }

  StationUI.registerWindow('factory', 'SOFTWARE FACTORY', buildFactory, { console: true });
})();
