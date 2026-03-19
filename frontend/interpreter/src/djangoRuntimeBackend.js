/* global window */
/**
 * DjangoRuntimeBackend — CogFlow Platform result submission adapter.
 *
 * Activated when `window.COGFLOW_PLATFORM_URL` is set to the platform's base
 * URL (e.g. "http://localhost:8000").  When not set, the module is a no-op so
 * the standard JATOS / local-download path is unaffected.
 *
 * Usage (platform index.html):
 *   <script>window.COGFLOW_PLATFORM_URL = 'http://localhost:8000';</script>
 *   <script>window.COGFLOW_STUDY_SLUG = 'my-study';</script>
 *   <script src="src/djangoRuntimeBackend.js"></script>
 */
(function () {
  'use strict';

  window.DjangoRuntimeBackend = {
    /** Internal: UUID of the current run session returned by /api/v1/runs/start. */
    _runSessionId: null,

    /**
     * Returns true when window.COGFLOW_PLATFORM_URL is a non-empty string.
     * @returns {boolean}
     */
    isEnabled: function () {
      try {
        return !!(
          typeof window !== 'undefined' &&
          window.COGFLOW_PLATFORM_URL &&
          typeof window.COGFLOW_PLATFORM_URL === 'string' &&
          window.COGFLOW_PLATFORM_URL.trim()
        );
      } catch (_) {
        return false;
      }
    },

    /** @returns {string} Base URL without trailing slash. */
    _baseUrl: function () {
      return (window.COGFLOW_PLATFORM_URL || '').toString().trim().replace(/\/+$/, '');
    },

    /**
     * POST /api/v1/runs/start — registers a new run session.
     *
     * @param {string} studySlug  Study identifier (matches a published config).
     * @param {string|null} [participantExternalId]  Optional participant code.
     * @returns {Promise<{run_session_id: string, study_slug: string, started_at: string}>}
     */
    startRun: async function (studySlug, participantExternalId) {
      const url = this._baseUrl() + '/api/v1/runs/start';
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            study_slug: studySlug || 'unknown',
            participant_external_id: participantExternalId || null,
          }),
        });
      } catch (networkErr) {
        throw new Error(
          '[DjangoRuntimeBackend] Network error calling startRun: ' +
            (networkErr && networkErr.message ? networkErr.message : String(networkErr))
        );
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(
          '[DjangoRuntimeBackend] startRun returned ' + resp.status + ': ' + errText
        );
      }

      const data = await resp.json();
      this._runSessionId = data.run_session_id || null;
      console.log('[DjangoRuntimeBackend] Run started:', this._runSessionId);
      return data;
    },

    /**
     * POST /api/v1/results/submit — submits the completed experiment payload.
     *
     * Call after startRun() has resolved.  The payload is the object produced
     * by main.js's buildResultPayload() (contains a `trials` array).
     *
     * @param {object} payload  CogFlow result payload with .trials array.
     * @returns {Promise<object>}
     */
    submitResult: async function (payload) {
      if (!this._runSessionId) {
        throw new Error(
          '[DjangoRuntimeBackend] submitResult called before startRun (no run_session_id)'
        );
      }

      const url = this._baseUrl() + '/api/v1/results/submit';
      const trials = Array.isArray(payload && payload.trials) ? payload.trials : [];

      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            run_session_id: this._runSessionId,
            status: 'completed',
            trial_count: trials.length,
            result_payload: payload || {},
            trials: trials,
          }),
        });
      } catch (networkErr) {
        throw new Error(
          '[DjangoRuntimeBackend] Network error calling submitResult: ' +
            (networkErr && networkErr.message ? networkErr.message : String(networkErr))
        );
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => String(resp.status));
        throw new Error(
          '[DjangoRuntimeBackend] submitResult returned ' + resp.status + ': ' + errText
        );
      }

      const data = await resp.json();
      console.log('[DjangoRuntimeBackend] Result submitted. Envelope:', data.result_envelope_id);
      return data;
    },
  };
})();
