/* SPACESTATION — aiteam.js : the AI TEAM console (Business OS Phase 3).

   Phase 1 gave a business a place to live; Phase 2 gave it a way to be created. This is the part that gives
   it a CREW: §7's twelve roles, §13's permission model, §9's four-scope memory, and the communication between
   them.

   WHAT THIS MODULE REFUSES TO DO, and why each refusal is the feature:
     · It does not present an agent as an autonomous being. An agent is a role + a class + a permission set +
       a memory scope. The console shows exactly those four things and nothing that implies a private agenda
       (P7).
     · It does not offer a class that cannot fill the chosen role. The specialty picker is built from the
       role's OWN list, so the pairing the sidecar would refuse is one the UI never proposes.
     · It does not offer a `restricted` grant as a checkbox. The tier exists in the catalogue, is labelled
       "explicit authorization and safeguards", and is shown as NEVER auto-grantable — because the sidecar
       forces it false and a checkbox that silently does nothing is worse than no checkbox.
     · It does not hide the evidence rule. A memory write shows its SOURCE field and the sidecar's 422 is
       rendered verbatim; the picker has no default, because a remembered fact with no provenance is
       indistinguishable from an invented one (P1).
     · It does not claim an agent is "working". The status is whatever the store says — idle/working/paused/
       disabled — and nothing here invents a progress number.

   TWO HALVES, ON PURPOSE — the pure half (labels, row shaping, option builders, guards) is UMD and
   Node-loadable so it is unit-tested headless; only mount() needs a DOM, and it degrades to a no-op. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.AITeam = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- vocabularies mirrored from the sidecar stores. Order is the store's. ----
  const STATUSES = ['idle', 'working', 'paused', 'disabled'];
  const STATUS_LABEL = { idle: 'IDLE', working: 'WORKING', paused: 'PAUSED', disabled: 'DISABLED' };

  const SCOPES = ['user', 'business', 'project', 'agent'];
  const SCOPE_LABEL = { user: 'USER', business: 'BUSINESS', project: 'PROJECT', agent: 'AGENT' };

  const KINDS = ['objective', 'decision', 'document', 'customer', 'product', 'experiment', 'failure', 'strategy', 'constraint', 'instruction', 'policy'];
  const KIND_LABEL = {
    objective: 'OBJECTIVE', decision: 'DECISION', document: 'DOCUMENT', customer: 'CUSTOMER',
    product: 'PRODUCT', experiment: 'EXPERIMENT', failure: 'FAILURE', strategy: 'STRATEGY',
    constraint: 'CONSTRAINT', instruction: 'INSTRUCTION', policy: 'POLICY'
  };

  const SOURCES = ['user', 'document', 'agent', 'import'];
  const SOURCE_LABEL = { user: 'you said', document: 'from a document', agent: 'an agent wrote', import: 'imported' };

  const MESSAGE_KINDS = ['note', 'request', 'handoff', 'decision', 'report'];
  const MESSAGE_KIND_LABEL = { note: 'NOTE', request: 'REQUEST', handoff: 'HANDOFF', decision: 'DECISION', report: 'REPORT' };

  const TIERS = ['safe', 'review', 'restricted'];
  const TIER_LABEL = { safe: 'SAFE', review: 'REVIEW', restricted: 'RESTRICTED' };
  // §13's own words, so the UI quotes the spec rather than paraphrasing it.
  const TIER_NOTE = {
    safe: 'runs automatically',
    review: 'needs your approval',
    restricted: 'cannot run without explicit authorization and safeguards'
  };

  function statusLabel(s) { return STATUS_LABEL[s] || String(s == null ? '' : s).toUpperCase(); }
  function scopeLabel(s) { return SCOPE_LABEL[s] || String(s == null ? '' : s).toUpperCase(); }
  function kindLabel(k) { return KIND_LABEL[k] || String(k == null ? '' : k).toUpperCase(); }
  function sourceLabel(s) { return SOURCE_LABEL[s] || String(s == null ? '' : s); }
  function messageKindLabel(k) { return MESSAGE_KIND_LABEL[k] || String(k == null ? '' : k).toUpperCase(); }
  function tierLabel(t) { return TIER_LABEL[t] || String(t == null ? '' : t).toUpperCase(); }

  // ---- option builders. A picker NEVER defaults to a value the store would refuse. ----
  function statusOptions(current) {
    return STATUSES.map(s => '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + esc(STATUS_LABEL[s]) + '</option>').join('');
  }
  function scopeOptions(current) {
    return SCOPES.map(s => '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + esc(SCOPE_LABEL[s]) + '</option>').join('');
  }
  function kindOptions(current) {
    // an explicit blank first option: "no filter" is a real choice, and a silent default would hide it.
    return '<option value=""' + (!current ? ' selected' : '') + '>— any kind —</option>' +
      KINDS.map(k => '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + esc(KIND_LABEL[k]) + '</option>').join('');
  }
  function kindPickOptions(current) {
    return KINDS.map(k => '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + esc(KIND_LABEL[k]) + '</option>').join('');
  }
  function sourceOptions(current) {
    return SOURCES.map(s => '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + esc(SOURCE_LABEL[s]) + '</option>').join('');
  }
  function messageKindOptions(current) {
    return MESSAGE_KINDS.map(k => '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + esc(MESSAGE_KIND_LABEL[k]) + '</option>').join('');
  }
  function roleOptions(roles, current) {
    return '<option value=""' + (!current ? ' selected' : '') + '>— pick a role —</option>' +
      (roles || []).map(r => '<option value="' + esc(r.id) + '"' + (r.id === current ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('');
  }
  // The classes offered for a role come from the ROLE ITSELF, so the UI never proposes a pairing the
  // sidecar would refuse.
  function specialtyOptions(roles, roleId, current) {
    const role = (roles || []).filter(r => r && r.id === roleId)[0];
    if (!role) return '<option value="">— pick a role first —</option>';
    return role.specialties.map(s => '<option value="' + esc(s.id) + '"' + (s.id === current ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  }
  function roleOf(roles, id) { return (roles || []).filter(r => r && r.id === id)[0] || null; }
  function specialtyName(roles, roleId, specId) {
    const role = roleOf(roles, roleId);
    if (!role) return specId || '';
    const s = role.specialties.filter(x => x.id === specId)[0];
    return s ? s.name : (specId || '');
  }

  // ---- row shaping ----
  function grantChips(grants) {
    const g = grants || {};
    const out = [];
    for (const t of TIERS) out.push({ tier: t, label: TIER_LABEL[t], on: !!g[t], note: TIER_NOTE[t] });
    return out;
  }

  function agentRows(agents, roles) {
    return (agents || []).map(a => ({
      id: a.id,
      name: a.name || a.id,
      role: a.role,
      roleLabel: (roleOf(roles, a.role) || {}).label || a.role,
      specialty: a.specialty,
      specialtyName: specialtyName(roles, a.role, a.specialty),
      status: a.status,
      statusLabel: statusLabel(a.status),
      paused: a.status === 'paused',
      grants: grantChips(a.grants),
      hiredBy: a.hiredBy === 'ai' ? 'an agent proposed this hire' : 'you hired this',
      responsibility: (roleOf(roles, a.role) || {}).responsibility || ''
    }));
  }

  // The permission view: one row per §13 action, decided by the sidecar against THIS agent's grants.
  function decisionRows(decisions) {
    return (decisions || []).map(d => ({
      action: d.action, label: d.label, tier: d.tier, tierLabel: tierLabel(d.tier),
      allow: !!d.allow, approval: d.approval,
      verdict: d.allow ? 'MAY DO' : (d.approval === 'required' ? 'NEEDS APPROVAL' : 'BLOCKED'),
      reason: d.reason || ''
    }));
  }

  function relTime(at, now) {
    if (!at) return '';
    const s = Math.max(0, Math.floor(((now || 0) - at) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function memoryRows(entries, now) {
    return (entries || []).map(e => ({
      id: e.id, scope: e.scope, scopeLabel: scopeLabel(e.scope), ownerId: e.ownerId,
      kind: e.kind, kindLabel: kindLabel(e.kind),
      text: e.text, source: e.source, sourceLabel: sourceLabel(e.source),
      at: e.at, when: relTime(e.at, now),
      businessId: e.businessId || ''
    }));
  }

  // A message row is shaped from the reader's point of view: direction is explicit, never inferred from order.
  function messageRows(messages, agents) {
    const nameOf = (id) => {
      if (id === 'user') return 'YOU';
      const a = (agents || []).filter(x => x && x.id === id)[0];
      return a ? a.name : id;
    };
    return (messages || []).map(m => ({
      id: m.id, from: m.from, to: m.to,
      fromName: nameOf(m.from), toName: nameOf(m.to),
      kind: m.kind, kindLabel: messageKindLabel(m.kind),
      subject: m.subject || '', body: m.body || '',
      refs: m.refs || [], at: m.at
    }));
  }

  // §26 in the console: a proposed action's approval is whatever the sidecar decided, never a guess here.
  function approvalLine(decision) {
    if (!decision) return '';
    return decision.approval === 'required' ? 'APPROVAL REQUIRED — ' + (decision.reason || '') : 'NO APPROVAL NEEDED — ' + (decision.reason || '');
  }

  /* HIRE GUARD — mirrors the sidecar's rule exactly: a role must be chosen, and the class must be one the
     role offers. A UI that offers a hire the engine rejects reads as a broken button. */
  function hireGuard(roles, roleId, specialtyId) {
    const role = roleOf(roles, roleId);
    if (!role) return { allowed: false, reason: 'Pick a role first — §7\'s twelve are listed in the catalogue above.' };
    if (!role.specialties.length) return { allowed: false, reason: 'That role names no classes — the role bridge is broken.' };
    const wanted = specialtyId || role.specialties[0].id;
    if (!role.specialties.some(s => s.id === wanted)) {
      return { allowed: false, reason: '"' + wanted + '" cannot fill the ' + role.label + ' role.' };
    }
    return { allowed: true, reason: '', specialty: wanted };
  }

  // A memory write mirrors the store: text + kind + source are all required (source is P1's provenance).
  function memoryGuard(draft) {
    draft = draft || {};
    if (!String(draft.text || '').trim()) return { allowed: false, reason: 'A memory needs some text.' };
    if (!draft.kind) return { allowed: false, reason: 'Pick what kind of memory this is.' };
    if (!draft.source) return { allowed: false, reason: 'Pick where this came from — a memory with no source cannot be told apart from an invented one.' };
    return { allowed: true, reason: '' };
  }

  function summaryLine(agents, roles) {
    const list = agents || [];
    if (!list.length) return 'No agents hired yet. A team is §7\'s twelve roles, each filled by a real class from the catalog.';
    const byStatus = {};
    for (const a of list) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const parts = Object.keys(byStatus).sort().map(s => statusLabel(s) + ' ' + byStatus[s]);
    return list.length + ' agent' + (list.length === 1 ? '' : 's') + ' · ' + parts.join(' · ');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // one request helper; the Response is kept in scope and r.ok read, so a plain-text 403 or a proxy HTML
  // page can never collapse into {} and render as success. Mirrors businessmaker.js.
  function request(method, path, body) {
    const init = { method: method, cache: 'no-store' };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body == null ? {} : body); }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, j: {} }; });
    });
  }

  function errText(r, fallback) {
    const j = r && r.j;
    if (j && typeof j.error === 'string' && j.error) return j.error;
    if (r && r.status) return fallback + ' (HTTP ' + r.status + ')';
    return fallback;
  }

  let live = null;
  let busWired = false;
  let refreshTimer = null;
  function scheduleRefresh() {
    if (!live || refreshTimer) return;
    refreshTimer = setTimeout(function () { refreshTimer = null; if (live) { try { live.refresh(); } catch (_) {} } }, 200);
  }
  function wireBus() {
    if (busWired) return;
    busWired = true;
    if (typeof U === 'undefined' || !U.bus || typeof U.bus.on !== 'function') return;
    const names = ['agent.hired', 'agent.updated', 'agent.fired', 'agent.assigned', 'agent.message',
      'business.memory.written', 'business.memory.forgotten', 'business.created'];
    for (const n of names) { try { U.bus.on(n, scheduleRefresh); } catch (_) {} }
  }

  function mount(body) {
    if (typeof document === 'undefined' || !body) return null;
    const SUI = (typeof StationUI !== 'undefined') ? StationUI : null;
    if (!SUI || !SUI.h || typeof SUI.h.mountConsole !== 'function') return null;

    const panes = {};
    SUI.h.mountConsole(body, 'team', [
      {
        id: 'team', label: 'TEAM', glyph: '▚',
        desc: 'The agents this business has hired. Each is a §7 role filled by a real class from the station catalog — a role, a permission set and a memory scope, not a private agenda. Pause one here (§19); nothing here runs it.',
        build: function (p) { panes.team = p; }
      },
      {
        id: 'hire', label: 'HIRE', glyph: '✚',
        desc: 'Add an agent. Pick one of §7\'s twelve roles, then one of the classes that role actually names. Permissions start at safe-only: an agent runs safe work unattended and asks for everything else.',
        build: function (p) { panes.hire = p; }
      },
      {
        id: 'memory', label: 'MEMORY', glyph: '▤',
        desc: '§9 keeps four separate scopes — user, business, project, agent. Every entry records where it came from; an entry with no source is refused. A business can never read another business\'s memory.',
        build: function (p) { panes.memory = p; }
      },
      {
        id: 'messages', label: 'MESSAGES', glyph: '✉',
        desc: 'What the team said to each other, and to you. Addressed and typed, so a handoff reads differently from a report — and both ends must belong to this business.',
        build: function (p) { panes.messages = p; }
      }
    ], { search: false });

    const state = {
      businesses: [], businessId: '', roles: [], tiers: [], unresolved: [],
      agents: [], decisions: [], selectedAgent: '',
      memory: [], memoryScope: 'business', memoryOwner: '', memoryKind: '',
      messages: [], messageWith: '',
      hireRole: '', hireSpecialty: '', hireName: '', hireGrants: { safe: true, review: false },
      draft: { kind: 'decision', text: '', source: 'user' },
      compose: { from: 'user', to: '', kind: 'note', subject: '', body: '' },
      error: '', notice: '', busy: false
    };

    /* Two-press confirmation, the house pattern. An OS modal (window.confirm) over the phosphor terminal is
       banned — test/station-tooltip.test.js enforces it — and armconfirm.js is the shared helper.
       FAIL-CLOSED: if ArmConfirm is absent the control is DISABLED rather than firing unconfirmed. */
    function arm(btn, label, onConfirm) {
      if (!btn) return;
      if (typeof ArmConfirm === 'undefined' || typeof ArmConfirm.wire !== 'function') {
        btn.disabled = true;
        btn.title = 'confirmation helper unavailable — refusing to act unconfirmed';
        return;
      }
      ArmConfirm.wire(btn, { armedLabel: label, onConfirm: onConfirm });
    }

    const api = (path) => path;
    const bizPath = (suffix) => '/api/businesses/' + encodeURIComponent(state.businessId) + suffix;

    function selectedAgent() { return state.agents.filter(a => a && a.id === state.selectedAgent)[0] || null; }

    // ---- loaders ----
    function loadBusinesses() {
      return request('GET', api('/api/businesses')).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load businesses'); return; }
        state.businesses = (r.j && r.j.businesses) || [];
        if (!state.businessId && state.businesses.length) state.businessId = state.businesses[0].id;
        if (state.businessId && !state.businesses.some(b => b.id === state.businessId)) state.businessId = state.businesses.length ? state.businesses[0].id : '';
      });
    }
    function loadRoles() {
      return request('GET', api('/api/roles')).then(function (r) {
        if (!r.ok) return;
        state.roles = (r.j && r.j.roles) || [];
        state.unresolved = (r.j && r.j.unresolved) || [];
      });
    }
    function loadPermissions() {
      return request('GET', api('/api/permissions')).then(function (r) {
        if (!r.ok) return;
        state.tiers = (r.j && r.j.tiers) || [];
      });
    }
    function loadAgents() {
      if (!state.businessId) { state.agents = []; return Promise.resolve(); }
      return request('GET', api(bizPath('/agents'))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load the team'); return; }
        state.agents = (r.j && r.j.agents) || [];
        if (state.selectedAgent && !state.agents.some(a => a.id === state.selectedAgent)) state.selectedAgent = '';
        if (!state.compose.to && state.agents.length) state.compose.to = state.agents[0].id;
      });
    }
    function loadMemory() {
      if (!state.businessId) { state.memory = []; return Promise.resolve(); }
      const owner = state.memoryOwner || (state.memoryScope === 'business' ? state.businessId : '');
      const q = '?scope=' + encodeURIComponent(state.memoryScope) + '&owner=' + encodeURIComponent(owner) +
        (state.memoryKind ? '&kind=' + encodeURIComponent(state.memoryKind) : '');
      return request('GET', api(bizPath('/memory') + q)).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load memory'); return; }
        state.memory = (r.j && r.j.entries) || [];
      });
    }
    function loadMessages() {
      if (!state.businessId) { state.messages = []; return Promise.resolve(); }
      const q = state.messageWith ? '?with=' + encodeURIComponent(state.messageWith) : '';
      return request('GET', api(bizPath('/messages') + q)).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not load messages'); return; }
        state.messages = (r.j && r.j.messages) || [];
      });
    }

    function refresh() {
      return loadBusinesses()
        .then(function () { return Promise.all([loadAgents(), loadMemory(), loadMessages()]); })
        .then(function () { renderAll(); });
    }

    function reloadSelectedAgent() {
      if (!state.selectedAgent) { state.decisions = []; return Promise.resolve(); }
      return request('GET', api('/api/agents/' + encodeURIComponent(state.selectedAgent))).then(function (r) {
        state.decisions = (r.ok && r.j && r.j.decisions) || [];
      });
    }

    function flash(msg) { state.notice = msg || ''; state.error = ''; renderAll(); }

    // ---- mutations ----
    function doHire() {
      const g = hireGuard(state.roles, state.hireRole, state.hireSpecialty);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      state.busy = true;
      request('POST', api(bizPath('/agents')), {
        role: state.hireRole, specialty: g.specialty, name: state.hireName,
        grants: { safe: !!state.hireGrants.safe, review: !!state.hireGrants.review }
      }).then(function (r) {
        state.busy = false;
        if (!r.ok) { state.error = errText(r, 'could not hire'); renderAll(); return; }
        state.hireRole = ''; state.hireSpecialty = ''; state.hireName = '';
        state.notice = 'Hired ' + ((r.j && r.j.agent && r.j.agent.name) || 'the agent') + '.';
        return refresh();
      });
    }

    function doStatus(agentId, status) {
      request('POST', api('/api/agents/' + encodeURIComponent(agentId) + '/status'), { status: status }).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not change status'); renderAll(); return; }
        return refresh();
      });
    }

    function doFire(agentId) {
      request('DELETE', api('/api/agents/' + encodeURIComponent(agentId))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not remove the agent'); renderAll(); return; }
        state.selectedAgent = '';
        state.notice = 'Agent removed.';
        return refresh();
      });
    }

    function doWriteMemory() {
      const g = memoryGuard(state.draft);
      if (!g.allowed) { state.error = g.reason; renderAll(); return; }
      const owner = state.memoryOwner || (state.memoryScope === 'business' ? state.businessId : '');
      request('POST', api(bizPath('/memory')), {
        scope: state.memoryScope, ownerId: owner, kind: state.draft.kind, text: state.draft.text, source: state.draft.source
      }).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not record the memory'); renderAll(); return; }
        state.draft.text = '';
        state.notice = 'Memory recorded.';
        return loadMemory().then(renderAll);
      });
    }

    function doForgetMemory(id) {
      request('DELETE', api('/api/memory/' + encodeURIComponent(id))).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not forget the entry'); renderAll(); return; }
        state.notice = 'Memory forgotten.';
        return loadMemory().then(renderAll);
      });
    }

    function doSendMessage() {
      const c = state.compose;
      if (!c.to) { state.error = 'Pick a recipient.'; renderAll(); return; }
      request('POST', api(bizPath('/messages')), { from: c.from, to: c.to, kind: c.kind, subject: c.subject, body: c.body }).then(function (r) {
        if (!r.ok) { state.error = errText(r, 'could not send the message'); renderAll(); return; }
        c.subject = ''; c.body = '';
        state.notice = 'Message sent.';
        return loadMessages().then(renderAll);
      });
    }

    // ---- renderers ----
    function renderAll() { renderTeam(); renderHire(); renderMemory(); renderMessages(); }

    function banner() {
      let html = '';
      if (state.error) html += '<div class="tm-err">' + esc(state.error) + '</div>';
      else if (state.notice) html += '<div class="tm-note">' + esc(state.notice) + '</div>';
      if (state.unresolved && state.unresolved.length) {
        html += '<div class="tm-err">The role bridge is broken — ' + esc(state.unresolved.length) + ' role class(es) no longer resolve. Those roles cannot be filled.</div>';
      }
      return html;
    }

    function bizPicker() {
      if (!state.businesses.length) return '<p class="tm-empty">No businesses yet. Create one in the Command Center first — the team belongs to a business.</p>';
      return '<label class="tm-field"><span>BUSINESS</span><select id="tm-biz">' +
        state.businesses.map(b => '<option value="' + esc(b.id) + '"' + (b.id === state.businessId ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
        '</select></label>';
    }

    function renderTeam() {
      const p = panes.team; if (!p) return;
      let html = banner() + bizPicker();
      if (!state.businessId) { p.innerHTML = html; return; }
      const rows = agentRows(state.agents, state.roles);
      html += '<div class="tm-sum">' + esc(summaryLine(state.agents, state.roles)) + '</div>';
      if (!rows.length) {
        html += '<p class="tm-empty">No agents yet. Use HIRE to fill one of §7\'s twelve roles.</p>';
      } else {
        html += '<div class="tm-rows">';
        for (const r of rows) {
          html += '<div class="tm-row' + (r.id === state.selectedAgent ? ' tm-sel' : '') + (r.paused ? ' tm-paused' : '') + '" data-id="' + esc(r.id) + '">' +
            '<div class="tm-row-main">' +
              '<span class="tm-name">' + esc(r.name) + '</span>' +
              '<span class="tm-role">' + esc(r.roleLabel) + '</span>' +
              '<span class="tm-spec">' + esc(r.specialtyName) + '</span>' +
              '<span class="tm-status tm-st-' + esc(r.status) + '">' + esc(r.statusLabel) + '</span>' +
            '</div>' +
            '<div class="tm-row-sub">' + esc(r.responsibility) + '</div>' +
            '<div class="tm-chips">' + r.grants.map(c =>
              '<span class="tm-chip' + (c.on ? ' tm-on' : '') + '" title="' + esc(c.note) + '">' + esc(c.label) + '</span>').join('') + '</div>' +
            '<div class="tm-acts">' +
              '<button class="tm-btn" data-act="inspect" data-id="' + esc(r.id) + '">PERMISSIONS</button>' +
              (r.paused
                ? '<button class="tm-btn" data-act="resume" data-id="' + esc(r.id) + '">RESUME</button>'
                : '<button class="tm-btn" data-act="pause" data-id="' + esc(r.id) + '">PAUSE</button>') +
              '<button class="tm-btn tm-danger" data-act="fire" data-id="' + esc(r.id) + '">REMOVE</button>' +
            '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      const a = selectedAgent();
      if (a) {
        html += '<div class="tm-detail"><div class="tm-detail-head">' + esc(a.name) + ' — what it may do unattended</div>';
        const dec = decisionRows(state.decisions);
        if (!dec.length) html += '<p class="tm-empty">Loading the permission view…</p>';
        else {
          html += '<div class="tm-decs">';
          for (const d of dec) {
            html += '<div class="tm-dec tm-t-' + esc(d.tier) + '">' +
              '<span class="tm-dec-name">' + esc(d.label) + '</span>' +
              '<span class="tm-dec-tier">' + esc(d.tierLabel) + '</span>' +
              '<span class="tm-dec-verdict">' + esc(d.verdict) + '</span>' +
            '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      p.innerHTML = html;
    }

    function renderHire() {
      const p = panes.hire; if (!p) return;
      let html = banner();
      if (!state.businessId) { html += '<p class="tm-empty">Pick a business first.</p>'; p.innerHTML = html; return; }

      html += '<div class="tm-form">' +
        '<label class="tm-field"><span>ROLE (§7)</span><select id="tm-role">' + roleOptions(state.roles, state.hireRole) + '</select></label>' +
        '<label class="tm-field"><span>CLASS</span><select id="tm-spec">' + specialtyOptions(state.roles, state.hireRole, state.hireSpecialty) + '</select></label>' +
        '<label class="tm-field"><span>NAME</span><input id="tm-name" type="text" placeholder="optional — defaults to the class name" value="' + esc(state.hireName) + '"></label>' +
        '<div class="tm-grants">' +
          '<label class="tm-check"><input type="checkbox" id="tm-g-safe"' + (state.hireGrants.safe ? ' checked' : '') + '> <span>SAFE — ' + esc(TIER_NOTE.safe) + '</span></label>' +
          '<label class="tm-check"><input type="checkbox" id="tm-g-review"' + (state.hireGrants.review ? ' checked' : '') + '> <span>REVIEW — ' + esc(TIER_NOTE.review) + '</span></label>' +
          '<label class="tm-check tm-locked" title="' + esc(TIER_NOTE.restricted) + '"><input type="checkbox" disabled> <span>RESTRICTED — never auto-grantable (§13)</span></label>' +
        '</div>' +
        '<button class="tm-btn tm-primary" id="tm-hire"' + (state.busy ? ' disabled' : '') + '>HIRE</button>' +
      '</div>';

      // §13's catalogue, quoted from the sidecar so the UI cannot drift from the tiers it enforces.
      if (state.tiers.length) {
        html += '<div class="tm-tiers"><div class="tm-tiers-head">§13 ACTION TIERS</div>';
        for (const g of state.tiers) {
          html += '<div class="tm-tier tm-t-' + esc(g.tier) + '"><span class="tm-tier-name">' + esc(tierLabel(g.tier)) + '</span>' +
            '<span class="tm-tier-note">' + esc(g.note) + '</span>' +
            '<span class="tm-tier-acts">' + g.actions.map(x => esc(x.label)).join(' · ') + '</span></div>';
        }
        html += '</div>';
      }
      p.innerHTML = html;
    }

    function renderMemory() {
      const p = panes.memory; if (!p) return;
      let html = banner();
      if (!state.businessId) { html += '<p class="tm-empty">Pick a business first.</p>'; p.innerHTML = html; return; }

      html += '<div class="tm-form tm-form-inline">' +
        '<label class="tm-field"><span>SCOPE</span><select id="tm-mscope">' + scopeOptions(state.memoryScope) + '</select></label>' +
        '<label class="tm-field"><span>OWNER</span><input id="tm-mowner" type="text" placeholder="' + (state.memoryScope === 'business' ? 'the business' : 'required') + '" value="' + esc(state.memoryOwner) + '"></label>' +
        '<label class="tm-field"><span>KIND</span><select id="tm-mkind">' + kindOptions(state.memoryKind) + '</select></label>' +
      '</div>';

      const rows = memoryRows(state.memory, Date.now());
      if (!rows.length) html += '<p class="tm-empty">Nothing remembered in this scope yet.</p>';
      else {
        html += '<div class="tm-rows">';
        for (const r of rows) {
          html += '<div class="tm-mrow">' +
            '<div class="tm-mrow-main"><span class="tm-mkind tm-k-' + esc(r.kind) + '">' + esc(r.kindLabel) + '</span>' +
            '<span class="tm-mscope">' + esc(r.scopeLabel) + '</span>' +
            '<span class="tm-msrc" title="provenance">' + esc(r.sourceLabel) + '</span>' +
            '<span class="tm-when">' + esc(r.when) + '</span></div>' +
            '<div class="tm-mtext">' + esc(r.text) + '</div>' +
            '<div class="tm-acts"><button class="tm-btn tm-danger" data-act="forget" data-id="' + esc(r.id) + '">FORGET</button></div>' +
          '</div>';
        }
        html += '</div>';
      }

      html += '<div class="tm-form tm-write">' +
        '<div class="tm-write-head">RECORD A MEMORY</div>' +
        '<label class="tm-field"><span>KIND</span><select id="tm-dkind">' + kindPickOptions(state.draft.kind) + '</select></label>' +
        '<label class="tm-field"><span>SOURCE — where this came from</span><select id="tm-dsource">' + sourceOptions(state.draft.source) + '</select></label>' +
        '<label class="tm-field"><span>TEXT</span><textarea id="tm-dtext" rows="2" placeholder="What should the business remember?">' + esc(state.draft.text) + '</textarea></label>' +
        '<button class="tm-btn tm-primary" id="tm-write">REMEMBER</button>' +
      '</div>';
      p.innerHTML = html;
    }

    function renderMessages() {
      const p = panes.messages; if (!p) return;
      let html = banner();
      if (!state.businessId) { html += '<p class="tm-empty">Pick a business first.</p>'; p.innerHTML = html; return; }

      const who = [{ id: 'user', name: 'YOU' }].concat(agentRows(state.agents, state.roles).map(a => ({ id: a.id, name: a.name })));
      html += '<label class="tm-field"><span>SHOW</span><select id="tm-mwith"><option value=""' + (!state.messageWith ? ' selected' : '') + '>everyone</option>' +
        who.map(w => '<option value="' + esc(w.id) + '"' + (w.id === state.messageWith ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') +
        '</select></label>';

      const rows = messageRows(state.messages, state.agents);
      if (!rows.length) html += '<p class="tm-empty">Nothing said yet.</p>';
      else {
        html += '<div class="tm-msgs">';
        for (const m of rows) {
          html += '<div class="tm-msg">' +
            '<div class="tm-msg-head"><span class="tm-mfrom">' + esc(m.fromName) + '</span>' +
            '<span class="tm-arrow">→</span><span class="tm-mto">' + esc(m.toName) + '</span>' +
            '<span class="tm-mkind2">' + esc(m.kindLabel) + '</span></div>' +
            (m.subject ? '<div class="tm-msubject">' + esc(m.subject) + '</div>' : '') +
            '<div class="tm-mbody">' + esc(m.body) + '</div>' +
          '</div>';
        }
        html += '</div>';
      }

      html += '<div class="tm-form tm-write">' +
        '<div class="tm-write-head">SEND</div>' +
        '<div class="tm-form-inline">' +
          '<label class="tm-field"><span>FROM</span><select id="tm-cfrom">' + who.map(w => '<option value="' + esc(w.id) + '"' + (w.id === state.compose.from ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select></label>' +
          '<label class="tm-field"><span>TO</span><select id="tm-cto">' + who.map(w => '<option value="' + esc(w.id) + '"' + (w.id === state.compose.to ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select></label>' +
          '<label class="tm-field"><span>KIND</span><select id="tm-ckind">' + messageKindOptions(state.compose.kind) + '</select></label>' +
        '</div>' +
        '<label class="tm-field"><span>SUBJECT</span><input id="tm-csubject" type="text" value="' + esc(state.compose.subject) + '"></label>' +
        '<label class="tm-field"><span>BODY</span><textarea id="tm-cbody" rows="2">' + esc(state.compose.body) + '</textarea></label>' +
        '<button class="tm-btn tm-primary" id="tm-send">SEND</button>' +
      '</div>';
      p.innerHTML = html;
    }

    // ---- wiring ----
    function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
    function checked(id) { const el = document.getElementById(id); return !!(el && el.checked); }

    function bindPane(pane, handler) {
      if (!pane) return;
      pane.addEventListener('change', handler);
      pane.addEventListener('click', handler);
    }

    const onTeam = function (ev) {
      const t = ev.target;
      if (t && t.id === 'tm-biz') { state.businessId = t.value; state.selectedAgent = ''; state.memoryOwner = ''; state.compose.to = ''; refresh(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (!act) return;
      const id = t.getAttribute('data-id');
      if (act === 'inspect') { state.selectedAgent = id; reloadSelectedAgent().then(renderAll); return; }
      if (act === 'pause') { doStatus(id, 'paused'); return; }
      if (act === 'resume') { doStatus(id, 'idle'); return; }
      if (act === 'fire') { arm(t, 'CONFIRM REMOVE', function () { doFire(id); }); return; }
    };

    const onHire = function (ev) {
      const t = ev.target;
      if (t && t.id === 'tm-role') { state.hireRole = t.value; state.hireSpecialty = ''; renderHire(); return; }
      if (t && t.id === 'tm-spec') { state.hireSpecialty = t.value; return; }
      if (t && t.id === 'tm-name') { state.hireName = t.value; return; }
      if (t && t.id === 'tm-g-safe') { state.hireGrants.safe = t.checked; return; }
      if (t && t.id === 'tm-g-review') { state.hireGrants.review = t.checked; return; }
      if (t && t.id === 'tm-hire') doHire();
    };

    const onMemory = function (ev) {
      const t = ev.target;
      if (t && t.id === 'tm-mscope') { state.memoryScope = t.value; loadMemory().then(renderAll); return; }
      if (t && t.id === 'tm-mowner') { state.memoryOwner = t.value; return; }
      if (t && t.id === 'tm-mkind') { state.memoryKind = t.value; loadMemory().then(renderAll); return; }
      if (t && t.id === 'tm-dkind') { state.draft.kind = t.value; return; }
      if (t && t.id === 'tm-dsource') { state.draft.source = t.value; return; }
      if (t && t.id === 'tm-dtext') { state.draft.text = t.value; return; }
      if (t && t.id === 'tm-write') { doWriteMemory(); return; }
      const act = t && t.getAttribute ? t.getAttribute('data-act') : null;
      if (act === 'forget') { arm(t, 'CONFIRM FORGET', function () { doForgetMemory(t.getAttribute('data-id')); }); }
    };

    const onMessages = function (ev) {
      const t = ev.target;
      if (t && t.id === 'tm-mwith') { state.messageWith = t.value; loadMessages().then(renderAll); return; }
      if (t && t.id === 'tm-cfrom') { state.compose.from = t.value; return; }
      if (t && t.id === 'tm-cto') { state.compose.to = t.value; return; }
      if (t && t.id === 'tm-ckind') { state.compose.kind = t.value; return; }
      if (t && t.id === 'tm-csubject') { state.compose.subject = t.value; return; }
      if (t && t.id === 'tm-cbody') { state.compose.body = t.value; return; }
      if (t && t.id === 'tm-send') doSendMessage();
    };

    bindPane(panes.team, onTeam);
    bindPane(panes.hire, onHire);
    bindPane(panes.memory, onMemory);
    bindPane(panes.messages, onMessages);

    wireBus();
    live = { refresh: refresh, state: state };

    return Promise.all([loadRoles(), loadPermissions(), loadBusinesses()])
      .then(function () { return Promise.all([loadAgents(), loadMemory(), loadMessages()]); })
      .then(function () { renderAll(); return live; });
  }

  return {
    STATUSES, STATUS_LABEL, SCOPES, SCOPE_LABEL, KINDS, KIND_LABEL, SOURCES, SOURCE_LABEL,
    MESSAGE_KINDS, MESSAGE_KIND_LABEL, TIERS, TIER_LABEL, TIER_NOTE,
    statusLabel, scopeLabel, kindLabel, sourceLabel, messageKindLabel, tierLabel,
    statusOptions, scopeOptions, kindOptions, kindPickOptions, sourceOptions, messageKindOptions,
    roleOptions, specialtyOptions, roleOf, specialtyName,
    grantChips, agentRows, decisionRows, memoryRows, messageRows, approvalLine, relTime,
    hireGuard, memoryGuard, summaryLine, esc, request, errText, mount
  };
});
