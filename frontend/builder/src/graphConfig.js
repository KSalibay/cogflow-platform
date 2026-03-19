// Microsoft Graph / SharePoint export configuration (client-side)
//
// IMPORTANT:
// - This is a static browser app (no backend). Do NOT add a client secret.
// - You must run via http(s) (e.g., VS Code Live Server). MSAL does not work on file://.
// - Create an Entra ID (Azure AD) App Registration as a Single-page application (SPA)
//   and add the correct Redirect URI(s) for your local/dev/prod URL.
//
// Docs: https://learn.microsoft.com/entra/identity-platform/quickstart-single-page-app

(function () {
    // Default folder path based on the user-provided SharePoint/OneDrive URL:
    // https://uonstaff-my.sharepoint.com/.../Documents/Research/Projects%20_%20Open/DP26_internal_external_attention/CRDM
    // Graph uses path segments (NOT the sharing URL).
    const defaultUploadFolderPath = 'Documents/Research/Projects _ Open/DP26_internal_external_attention/CRDM';

    const GRAPH_CONFIG = {
        // Required: set this to your App Registration (client) ID
        clientId: '',

        // Optional: set to your tenant ID (GUID) for stricter control.
        // Use 'organizations' to allow work/school accounts.
        tenantId: 'organizations',

        // Delegated scopes for uploading into the signed-in user's OneDrive for Business.
        // If you later target a Team site / shared drive, you may need broader permissions.
        scopes: ['User.Read', 'Files.ReadWrite'],

        // Upload target (relative to drive root)
        defaultUploadFolderPath,

        // Popup login is generally simplest for a button-driven flow.
        interactionType: 'popup'
    };

    // Rebrand aliasing: keep the legacy global for backwards compatibility.
    window.COGFLOW_GRAPH_CONFIG = GRAPH_CONFIG;
    window.PSYCHJSON_GRAPH_CONFIG = GRAPH_CONFIG;
})();
