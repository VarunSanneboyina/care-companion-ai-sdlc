// Care Companion rules. Every rule here traces back to a line in intent.md.
// Sample data only. Not medical advice.
(function (root) {
  // Targets are set by clinicians in configuration (intent.md: Rules and limits).
  var CONFIG = { a1cTarget: 7.0, a1cMin: 3.0, a1cMax: 20.0 };

  function validateHbA1c(value) {
    var n = Number(value);
    if (value === '' || value === null || value === undefined || !isFinite(n)) {
      return { ok: false, error: 'Enter a number.' };
    }
    if (n < CONFIG.a1cMin || n > CONFIG.a1cMax) {
      return { ok: false, error: 'HbA1c must be between ' + CONFIG.a1cMin.toFixed(1) + ' and ' + CONFIG.a1cMax.toFixed(1) + '.' };
    }
    return { ok: true, value: n };
  }

  function a1cStatus(value) {
    return value <= CONFIG.a1cTarget ? 'At or below target' : 'Above target';
  }

  function filterPatients(list, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
  }

  function latest(p) { return p.readings[p.readings.length - 1]; }

  function sortByLatest(list, direction) {
    var dir = direction === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) { return (latest(a).a1c - latest(b).a1c) * dir; });
  }

  function addReading(patient, a1c, date) {
    var v = validateHbA1c(a1c);
    if (!v.ok) return v;
    if (!date) return { ok: false, error: 'Choose a date.' };
    patient.readings.push({ a1c: v.value, date: date });
    return { ok: true };
  }

  var api = { CONFIG: CONFIG, validateHbA1c: validateHbA1c, a1cStatus: a1cStatus,
              filterPatients: filterPatients, sortByLatest: sortByLatest,
              addReading: addReading, latest: latest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CareLogic = api;
})(typeof window !== 'undefined' ? window : this);
