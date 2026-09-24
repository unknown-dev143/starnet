/* STARNET — windows/worker.js : the AI WORKER window slot (Business OS Phase 6).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — the policy catalogue, the work-order list, the
   plan builder and the §13 step decisions — lives in app/businessworker.js so it stays Node-testable; the
   <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads WORKER, this
   registers 'WORKER', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildWorker(body) {
    if (typeof BusinessWorkerConsole === 'undefined' || typeof BusinessWorkerConsole.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "no work orders yet".
      body.innerHTML = '<p class="wk-empty">The AI Worker engine did not load — check that ' +
        '<b>app/businessworker.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessWorkerConsole.mount(body);
  }

  StationUI.registerWindow('worker', 'WORKER', buildWorker, { console: true });
})();
