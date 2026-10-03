/* SPACESTATION — windows/creatorstudio.js : the CREATOR STUDIO window slot (§20).

   Same extracted-window seam as its siblings: this file owns the window KEY and its title, nothing else.
   The engine — the §17 pipeline and the dated calendar — lives in app/creatorstudio.js so it stays
   Node-testable; the <script> order in index.html loads the engine first.

   TITLE LAW: the dock button's label must match (or prefix) the window title. The dock reads
   CREATOR STUDIO, this registers 'CREATOR STUDIO', so the pair cannot drift apart. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  function buildCreatorStudio(body) {
    if (typeof CreatorStudioUI === 'undefined' || typeof CreatorStudioUI.mount !== 'function') {
      // honest degradation: say the engine is missing rather than rendering an empty pipeline that a
      // reader would take for "you create nothing".
      body.innerHTML = '<p class="cs-empty">The Creator Studio engine did not load — check that ' +
        '<b>app/creatorstudio.js</b> is loaded by index.html.</p>';
      return;
    }
    CreatorStudioUI.mount(body);
  }

  StationUI.registerWindow('creatorstudio', 'CREATOR STUDIO', buildCreatorStudio, { console: true });
})();
