// Shared helpers for the three front-ends. Each site talks to the same API (window.API_BASE).
(function () {
  var API = window.API_BASE || '';
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; };
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };

  window.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  window.$ = function (id) { return document.getElementById(id); };
  window.getRole = function () { return ls('role') || 'requester'; };
  window.setRole = function (r) { ls('role', r); };

  window.toast = function (msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  };

  window.api = async function (path, opts, retried) {
    opts = opts || {};
    var h = { 'content-type': 'application/json', 'x-role': getRole() };
    if (ss('code')) h['x-access-code'] = ss('code');
    if (ss('rolecode')) h['x-role-code'] = ss('rolecode');
    var r = await fetch(API + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && !retried) {
      var c = prompt('This demo needs an access code:');
      if (c) { ss('code', c); return api(path, opts, true); }
    }
    if (r.status === 403 && /Role code/.test(j.error || '') && !retried) {
      var rc = prompt('Role code for ' + getRole().replace('_', ' ') + ':');
      if (rc) { ss('rolecode', rc); return api(path, opts, true); }
    }
    if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
    return j;
  };

  // Show an instruction file from the repository in a dialog.
  window.showFile = async function (path) {
    var d = $('filedlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'filedlg'; document.body.appendChild(d); }
    d.innerHTML = '<p class="muted">Loading…</p>'; d.showModal();
    try {
      var f = await api('/api/file?path=' + encodeURIComponent(path));
      d.innerHTML = '<div class="row" style="justify-content:space-between"><strong>' + esc(path) + '</strong><button class="ghost" id="fclose">Close</button></div>' +
        '<p class="muted">This is the exact file in the repository that the agent is given.</p><pre>' + esc(f.content) + '</pre>';
    } catch (e) { d.innerHTML = '<p class="err">' + esc(e.message) + '</p><button class="ghost" id="fclose">Close</button>'; }
    $('fclose').onclick = function () { d.close(); };
  };

  // Role picker (a demo stand-in for login; see README for the production note).
  window.mountRoleBar = function (el, onChange) {
    el.innerHTML = '<label for="rolesel" style="display:inline;margin-right:6px">Acting as</label><select id="rolesel" style="width:auto">' +
      ['requester:Requester', 'product_owner:Product owner', 'engineer:Engineer'].map(function (x) { var p = x.split(':'); return '<option value="' + p[0] + '"' + (getRole() === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select>';
    $('rolesel').onchange = function (e) { setRole(e.target.value); ss('rolecode', ''); if (onChange) onChange(); };
  };

  window.modelBadge = async function (el) {
    try {
      var c = await api('/api/config');
      el.className = 'badge-live chip ' + (c.live ? 'ok' : 'warn');
      el.textContent = c.live ? 'Claude connected · ' + c.model : 'Scripted mode · no model key set';
      return c;
    } catch (e) { el.className = 'badge-live chip warn'; el.textContent = 'API unreachable'; }
  };

  window.links = function () { return window.LINKS || {}; };
  window.fmtTime = function (iso) { try { return new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); } catch (e) { return iso; } };
  window.STATUS = { intake: 'Intake', po_review: 'Product owner review', engineer_review: 'Engineer review', approved: 'Approved', released: 'Live', changes_requested: 'Changes requested', rejected: 'Rejected' };
})();
