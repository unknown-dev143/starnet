/* STARNET — windows/mission.js : the MISSION CONTROL window slot (Business OS Phase 11, §23).

   Same extracted-window seam as its siblings: this file owns the window KEY and its title, nothing else. The
   engine — the ranked board, the fleet figures, the trail and the reasons — lives in app/businessmission.js
   so it stays Node-testable; index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads MISSION
   CONTROL, this registers 'MISSION CONTROL', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildMission(body) {
    if (typeof BusinessMissionUI === 'undefined' || typeof BusinessMissionUI.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty board, which a reader
      // would take for "nothing is running" — the worst possible misreading of a mission view.
      body.innerHTML = '<p class="mssn-empty">The Mission Control engine did not load — check that ' +
        '<b>app/businessmission.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessMissionUI.mount(body);
  }

  StationUI.registerWindow('mission', 'MISSION CONTROL', buildMission, { console: true });
})();
