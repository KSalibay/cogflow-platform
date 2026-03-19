/* global msal */

(function () {
    const CONFIG_KEY = 'cogflow_graph_export_settings_v1';
    const LEGACY_CONFIG_KEY = 'psychjson_graph_export_settings_v1';

    function getRuntimeConfig() {
        const base = window.COGFLOW_GRAPH_CONFIG || window.PSYCHJSON_GRAPH_CONFIG || {};

        let stored = {};
        try {
            stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || localStorage.getItem(LEGACY_CONFIG_KEY) || '{}') || {};
        } catch {
            stored = {};
        }

        const merged = {
            clientId: stored.clientId || base.clientId || '',
            tenantId: stored.tenantId || base.tenantId || 'organizations',
            scopes: Array.isArray(stored.scopes) ? stored.scopes : (base.scopes || ['User.Read', 'Files.ReadWrite']),
            defaultUploadFolderPath: stored.defaultUploadFolderPath || base.defaultUploadFolderPath || '',
            interactionType: stored.interactionType || base.interactionType || 'popup'
        };

        return merged;
    }

    function saveRuntimeConfig(partial) {
        const current = getRuntimeConfig();
        const next = { ...current, ...partial };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(next));
        return next;
    }

    function ensureHttpOrigin() {
        // MSAL browser does not support file://
        if (window.location.protocol === 'file:') {
            throw new Error('This feature requires running the app via http(s) (e.g., VS Code Live Server), not file://');
        }
    }

    function encodePathSegments(path) {
        // Keep slashes, encode each segment.
        return String(path || '')
            .split('/')
            .filter(Boolean)
            .map((seg) => encodeURIComponent(seg))
            .join('/');
    }

    function buildMsalInstance(cfg) {
        if (!window.msal || !msal.PublicClientApplication) {
            throw new Error('MSAL library not loaded. Ensure msal-browser script is included.');
        }

        const authority = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}`;

        return new msal.PublicClientApplication({
            auth: {
                clientId: cfg.clientId,
                authority,
                redirectUri: window.location.href.split('#')[0]
            },
            cache: {
                cacheLocation: 'localStorage',
                storeAuthStateInCookie: false
            }
        });
    }

    async function pickAccount(msalInstance) {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length === 1) return accounts[0];
        if (accounts.length > 1) {
            // Heuristic: use the first account; for more complex cases we could prompt.
            return accounts[0];
        }
        return null;
    }

    async function acquireToken(msalInstance, cfg) {
        const account = await pickAccount(msalInstance);

        const tokenRequest = {
            scopes: cfg.scopes,
            account: account || undefined
        };

        if (account) {
            try {
                const silent = await msalInstance.acquireTokenSilent(tokenRequest);
                return silent.accessToken;
            } catch {
                // fall through to interactive
            }
        }

        // Interactive sign-in/token
        if (cfg.interactionType === 'redirect') {
            await msalInstance.acquireTokenRedirect(tokenRequest);
            // Redirect will navigate away.
            throw new Error('Redirecting for sign-in...');
        }

        const interactive = await msalInstance.acquireTokenPopup({
            scopes: cfg.scopes,
            prompt: 'select_account'
        });
        return interactive.accessToken;
    }

    async function uploadJsonToOneDriveFolder({ jsonText, filename, folderPath }) {
        ensureHttpOrigin();

        const cfg = getRuntimeConfig();
        if (!cfg.clientId) {
            throw new Error('Graph export is not configured: missing clientId in src/graphConfig.js (or saved settings).');
        }

        const resolvedFolder = String(folderPath || cfg.defaultUploadFolderPath || '').trim();
        if (!resolvedFolder) {
            throw new Error('Missing SharePoint/OneDrive folder path for export.');
        }

        const msalInstance = buildMsalInstance(cfg);

        // If any redirect response is present, handle it (safe even if using popup)
        try {
            await msalInstance.handleRedirectPromise();
        } catch {
            // ignore
        }

        const accessToken = await acquireToken(msalInstance, cfg);

        const encodedFolder = encodePathSegments(resolvedFolder);
        const encodedFilename = encodeURIComponent(filename);

        // Upload to the signed-in user's OneDrive for Business root.
        // This matches personal SharePoint "My" sites like uonstaff-my.sharepoint.com.
        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedFolder}/${encodedFilename}:/content`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: jsonText
        });

        if (!response.ok) {
            let details = '';
            try {
                const err = await response.json();
                details = err?.error?.message || JSON.stringify(err);
            } catch {
                details = await response.text();
            }
            throw new Error(`Graph upload failed (${response.status}): ${details}`);
        }

        const driveItem = await response.json();
        return driveItem;
    }

    async function uploadFileToOneDriveFolder({ file, filename, folderPath, contentType }) {
        ensureHttpOrigin();

        const cfg = getRuntimeConfig();
        if (!cfg.clientId) {
            throw new Error('Graph export is not configured: missing clientId in src/graphConfig.js (or saved settings).');
        }

        const resolvedFolder = String(folderPath || cfg.defaultUploadFolderPath || '').trim();
        if (!resolvedFolder) {
            throw new Error('Missing SharePoint/OneDrive folder path for export.');
        }

        if (!file) {
            throw new Error('Missing file to upload.');
        }

        const name = String(filename || (file && file.name) || '').trim();
        if (!name) {
            throw new Error('Missing filename for upload.');
        }

        const msalInstance = buildMsalInstance(cfg);

        // If any redirect response is present, handle it (safe even if using popup)
        try {
            await msalInstance.handleRedirectPromise();
        } catch {
            // ignore
        }

        const accessToken = await acquireToken(msalInstance, cfg);

        const encodedFolder = encodePathSegments(resolvedFolder);
        const encodedFilename = encodeURIComponent(name);

        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedFolder}/${encodedFilename}:/content`;

        const ct = String(contentType || (file && file.type) || 'application/octet-stream');

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': ct
            },
            body: file
        });

        if (!response.ok) {
            let details = '';
            try {
                const err = await response.json();
                details = err?.error?.message || JSON.stringify(err);
            } catch {
                details = await response.text();
            }
            throw new Error(`Graph upload failed (${response.status}): ${details}`);
        }

        const driveItem = await response.json();
        return driveItem;
    }

    async function promptAndPersistSettings() {
        const current = getRuntimeConfig();

        const clientId = prompt('Enter Entra ID App (client) ID for Graph export:', current.clientId || '');
        if (clientId === null) return null;

        const tenantId = prompt('Enter tenant ID (GUID) or "organizations":', current.tenantId || 'organizations');
        if (tenantId === null) return null;

        const folderPath = prompt(
            'Enter OneDrive/SharePoint folder path relative to drive root (example starts with Documents/...):',
            current.defaultUploadFolderPath || ''
        );
        if (folderPath === null) return null;

        const next = saveRuntimeConfig({
            clientId: String(clientId).trim(),
            tenantId: String(tenantId).trim() || 'organizations',
            defaultUploadFolderPath: String(folderPath).trim()
        });

        return next;
    }

    window.GraphSharePointClient = {
        getRuntimeConfig,
        promptAndPersistSettings,
        uploadJsonToOneDriveFolder,
        uploadFileToOneDriveFolder
    };
})();
