// OP Hub — API fetch wrappers with caching
// Depends on state.js (cache variables)

async function fetchSessions(force) {
  if (!force && _sessionListCache) return _sessionListCache;
  if (_sessionFetchInFlight) return _sessionFetchInFlight;
  _sessionFetchInFlight = fetch('/api/sessions').then(function(r) { return r.json(); }).then(function(data) {
    _sessionListCache = data;
    _sessionFetchInFlight = null;
    return data;
  }).catch(function(err) {
    _sessionFetchInFlight = null;
    throw err;
  });
  return _sessionFetchInFlight;
}

function invalidateSessionCache() {
  _sessionListCache = null;
}

async function fetchJobs(force) {
  if (!force && _jobsCache) return _jobsCache;
  if (_jobsFetchInFlight) return _jobsFetchInFlight;
  _jobsFetchInFlight = fetch('/api/jobs').then(function(r) { return r.json(); }).then(function(data) {
    _jobsCache = data;
    _jobsFetchInFlight = null;
    return data;
  }).catch(function(err) {
    _jobsFetchInFlight = null;
    throw err;
  });
  return _jobsFetchInFlight;
}

function invalidateJobsCache() {
  _jobsCache = null;
}
