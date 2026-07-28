// github.js — persist tasks.db to a GitHub repo using the Contents API and a
// fine-grained Personal Access Token the user pastes into Settings.
// The token is kept ONLY in this browser's localStorage — it is never written
// to any file that gets committed to the repo.

const CAGitHub = (() => {
  const API = 'https://api.github.com';

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function headers(token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async function contentsUrl(cfg) {
    const path = encodeURIComponent(cfg.path).replace(/%2F/g, '/');
    return `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  }

  // Fetch the current tasks.db (and its sha, needed for the next write) from GitHub.
  async function pull(cfg) {
    const url = await contentsUrl(cfg);
    const res = await fetch(url, { headers: headers(cfg.token) });
    if (res.status === 404) {
      return { bytes: null, sha: null, notFound: true };
    }
    if (!res.ok) {
      throw new Error(await describeError(res));
    }
    const json = await res.json();
    if (Array.isArray(json)) throw new Error(`"${cfg.path}" points at a folder, not a file.`);
    return { bytes: base64ToBytes(json.content), sha: json.sha, notFound: false };
  }

  // Push new db bytes to GitHub. sha is required when overwriting an existing file
  // (pass the sha you most recently pulled — GitHub rejects the write if the file
  // has changed since, so pull() again if you get a 409).
  async function push(cfg, bytes, message, sha) {
    const path = encodeURIComponent(cfg.path).replace(/%2F/g, '/');
    const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
    const body = {
      message: message || `Update tasks.db — ${new Date().toISOString()}`,
      content: bytesToBase64(bytes),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error('The file on GitHub changed since you last pulled it. Click "Pull Latest" and re-apply your edit before saving.');
      }
      throw new Error(await describeError(res));
    }
    const json = await res.json();
    return { sha: json.content.sha };
  }

  // A lightweight call to confirm the token + repo + path are all valid and reachable.
  async function testConnection(cfg) {
    const url = `${API}/repos/${cfg.owner}/${cfg.repo}`;
    const res = await fetch(url, { headers: headers(cfg.token) });
    if (!res.ok) throw new Error(await describeError(res));
    const repo = await res.json();
    return { defaultBranch: repo.default_branch, private: repo.private, fullName: repo.full_name };
  }

  async function describeError(res) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (_) {}
    if (res.status === 401) return 'GitHub rejected the token (401 Unauthorized). Check that it was copied correctly and hasn\'t expired.';
    if (res.status === 403) return `GitHub says this token isn't allowed to do that (403). ${detail} — check the token's repository access and "Contents" permission.`;
    if (res.status === 404) return `Repo or file not found (404). Check the owner/repo/branch/path in Settings. ${detail}`;
    return `GitHub API error ${res.status}: ${detail}`;
  }

  return { pull, push, testConnection };
})();
