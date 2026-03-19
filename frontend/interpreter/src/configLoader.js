(function () {
  function normalizeBaseUrl(raw, fallback) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return fallback;
    }

    const trimmed = raw.trim();

    // Reject obvious non-network schemes.
    if (/^(javascript:|data:|file:)/i.test(trimmed)) {
      return fallback;
    }

    // Remove trailing slashes to simplify joining.
    return trimmed.replace(/\/+$/, '');
  }

  function joinUrl(base, path) {
    const safeBase = normalizeBaseUrl(base, 'configs');
    const safePath = String(path || '').replace(/^\/+/, '');
    return `${safeBase}/${safePath}`;
  }

  function normalizeManifestUrl(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^(javascript:|data:|file:)/i.test(trimmed)) return null;
    return trimmed;
  }

  function sanitizeId(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, '');
    return safe || null;
  }

  async function loadConfigById(id, options) {
    const safeId = sanitizeId(id);
    if (!safeId) {
      throw new Error('Invalid id. Allowed: A-Z a-z 0-9 _ -');
    }

    const baseUrl = options && options.baseUrl ? options.baseUrl : 'configs';
    const url = joinUrl(baseUrl, `${encodeURIComponent(safeId)}.json`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to load ${url} (${res.status})`);
    }

    const json = await res.json();
    return { id: safeId, sourceUrl: url, config: json };
  }

  async function listConfigs(options) {
    const baseUrl = options && options.baseUrl ? options.baseUrl : 'configs';
    const manifestUrl = normalizeManifestUrl(options && options.manifestUrl);

    // Best-effort: explicit manifest URL (useful for remote hosts like SharePoint).
    if (manifestUrl) {
      try {
        const res = await fetch(manifestUrl, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json)) {
            return json.filter((x) => typeof x === 'string' && x.toLowerCase().endsWith('.json'));
          }
        }
      } catch {
        // ignore
      }
    }

    // Best-effort directory scrape (works when hosted by servers that return HTML listings).
    try {
      const res = await fetch(joinUrl(baseUrl, ''), { cache: 'no-store' });
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          const html = await res.text();
          const re = /href\s*=\s*"([^"]+\.json)"/gi;
          const files = new Set();
          let m;
          while ((m = re.exec(html)) !== null) {
            const href = m[1];
            const name = href.split('/').pop();
            if (name && name.toLowerCase().endsWith('.json')) files.add(name);
          }
          if (files.size > 0) return Array.from(files);
        }
      }
    } catch {
      // ignore
    }

    // Fallback: explicit manifest file (optional).
    try {
      const res = await fetch(joinUrl(baseUrl, 'manifest.json'), { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          return json.filter((x) => typeof x === 'string' && x.toLowerCase().endsWith('.json'));
        }
      }
    } catch {
      // ignore
    }

    return [];
  }

  async function loadConfigsByCode(code, options) {
    const safeCode = sanitizeId(code);
    if (!safeCode || !/^[A-Za-z0-9]{7}$/.test(safeCode)) {
      throw new Error('Invalid code. Expected 7 alphanumeric characters.');
    }

    const files = await listConfigs(options);
    const prefix = `${safeCode}-`;
    const matches = files.filter((f) => typeof f === 'string' && f.startsWith(prefix) && f.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    if (matches.length === 0) {
      // Back-compat: treat code as a normal id.
      return [await loadConfigById(safeCode, options)];
    }

    const out = [];
    for (const fileName of matches) {
      const base = fileName.replace(/\.json$/i, '');
      const baseUrl = options && options.baseUrl ? options.baseUrl : 'configs';
      const url = joinUrl(baseUrl, encodeURIComponent(fileName));
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load configs/${fileName} (${res.status})`);
      const json = await res.json();
      out.push({ id: base, sourceUrl: url, config: json });
    }

    return out;
  }

  function loadConfigFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file provided'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = () => {
        try {
          const json = JSON.parse(String(reader.result || ''));
          resolve({ id: null, sourceUrl: null, config: json });
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e && e.message ? e.message : String(e)}`));
        }
      };
      reader.readAsText(file);
    });
  }

  window.ConfigLoader = {
    normalizeBaseUrl,
    sanitizeId,
    loadConfigById,
    loadConfigFromFile,
    listConfigs,
    loadConfigsByCode
  };
})();
