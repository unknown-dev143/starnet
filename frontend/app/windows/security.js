/* STARNET — windows/security.js : the SECURITY CENTER window slot (Business OS Phase 10, §13).

   Same extracted-window seam as its siblings: this file owns the window KEY and its title, nothing else. The
   engine — the counts, the capability table, the who-can-do-what grid and the audit slice — lives in
   app/businesssecurity.js so it stays Node-testable; index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads
   SECURITY CENTER, this registers 'SECURITY CENTER', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildSecurity(body) {
    if (typeof BusinessSecurityUI === 'undefined' || typeof BusinessSecurityUI.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty console that a reader
      // would take for "nothing is held and nothing happened" — the worst possible misreading of a
      // security view.
      body.innerHTML = '<p class="se-empty">The Security Center engine did not load — check that ' +
        '<b>app/businesssecurity.js</b> is loaded by index.html.</p>';
      return;
    }
    BusinessSecurityUI.mount(body);
  }

  StationUI.registerWindow('security', 'SECURITY CENTER', buildSecurity, { console: true });
})();
