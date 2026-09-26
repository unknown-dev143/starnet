/* STARNET — windows/autopilot.js : the GOAL AUTOPILOT window slot (Business OS Phase 12, §9).

   The extracted-window seam stationui.js exposes (see its "EXTRACTED-WINDOW SEAM" note): this file owns the
   window KEY and its title, and nothing else. The engine — the goal catalogue, the plan preview, the refusal
   shaping and the commit — lives in app/businessautopilot.js so it stays Node-testable; the <script> order
   in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads GOAL AUTOPILOT,
   this registers 'GOAL AUTOPILOT', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildAutopilot(body) {
    if (typeof BusinessAutopilotConsole === 'undefined' || typeof BusinessAutopilotConsole.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that reads as
      // "no goals known yet".
      body.innerHTML = '<p class="ap-empty">The Goal Autopilot engine did not load — check that ' +
        '<b>app/businessautopilot.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessAutopilotConsole.mount(body);
  }

  StationUI.registerWindow('autopilot', 'GOAL AUTOPILOT', buildAutopilot, { console: true });
})();
