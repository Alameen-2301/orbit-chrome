export async function secureStorage() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
    chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  ]);
}

export async function loadConnections() {
  const data = await chrome.storage.local.get(['orbit-profiles', 'orbit-selected', 'orbit-preferences']);
  return { profiles: data['orbit-profiles'] || [], selected: data['orbit-selected'] || '', preferences: data['orbit-preferences'] || {} };
}

export async function loadSecrets(id) {
  const key = `credentials:${id}`;
  const [session, local] = await Promise.all([chrome.storage.session.get(key), chrome.storage.local.get(key)]);
  return session[key] || local[key] || {apiKey: '', extraHeaders: {}};
}

export async function saveConnection(profile, secrets, profiles, preferences) {
  const next = [...profiles.filter(p => p.id !== profile.id), profile];
  const key = `credentials:${profile.id}`;
  // Save credentials before switching the selected connection, and remove the other copy.
  const destination = profile.remember ? chrome.storage.local : chrome.storage.session;
  const other = profile.remember ? chrome.storage.session : chrome.storage.local;
  await destination.set({[key]: secrets});
  await other.remove(key);
  await chrome.storage.local.set({'orbit-profiles': next, 'orbit-selected': profile.id, 'orbit-preferences': preferences});
  return next;
}

export async function deleteConnection(id, profiles) {
  const next = profiles.filter(p => p.id !== id);
  await chrome.storage.local.set({'orbit-profiles': next, 'orbit-selected': next[0]?.id || ''});
  await chrome.storage.session.remove(`credentials:${id}`);
  await chrome.storage.local.remove(`credentials:${id}`);
  return next;
}
