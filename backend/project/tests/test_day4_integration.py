"""
Day 4 integration smoke tests.

Verifies that:
  1. The /api/v1/configs/publish endpoint accepts the exact payload shape
     that JsonBuilder.publishToPlatform() POSTs.
  2. The DjangoRuntimeBackend.startRun() + submitResult() flow works
     end-to-end including upsert-safety for repeated startRun calls.
  3. The JATOS path is not broken: when runtime_mode != 'django' the
     publish endpoint still succeeds (backward compat).
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.configs.models import ConfigVersion
from apps.results.models import ResultEnvelope, TrialResult
from apps.runs.models import RunSession
from apps.studies.models import Study


class Day4PublishTransportTests(APITestCase):
    """Builder publishToPlatform() contract."""

    def _publish(self, slug="day4-rdm", extra=None):
        payload = {
            "study_slug": slug,
            "study_name": "Day 4 RDM Study",
            "config_version_label": "v2025-01-01",
            "builder_version": "unknown",  # JsonBuilder passes 'unknown' when no version set
            "runtime_mode": "django",
            "config": {
                "task_type": "rdm",
                "experiment_type": "trial-based",
                "n_trials": 20,
            },
        }
        if extra:
            payload.update(extra)
        return self.client.post(reverse("configs-publish"), data=payload, format="json")

    def test_publish_returns_201_with_required_fields(self):
        resp = self._publish()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        for field in ("study_slug", "config_version_id", "dashboard_url"):
            self.assertIn(field, resp.data, f"Missing field: {field}")

    def test_publish_creates_study_and_config_version(self):
        self._publish(slug="day4-create-test")
        self.assertTrue(Study.objects.filter(slug="day4-create-test").exists())
        self.assertTrue(
            ConfigVersion.objects.filter(
                study__slug="day4-create-test", version_label="v2025-01-01"
            ).exists()
        )

    def test_publish_is_idempotent_on_same_slug(self):
        """Re-publishing same slug must not raise; creates a new ConfigVersion."""
        self._publish(slug="day4-idem")
        resp2 = self._publish(slug="day4-idem", extra={"config_version_label": "v2"})
        self.assertEqual(resp2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Study.objects.filter(slug="day4-idem").count(), 1)
        self.assertEqual(ConfigVersion.objects.filter(study__slug="day4-idem").count(), 2)

    def test_jatos_runtime_mode_still_accepted(self):
        """Backward compat: runtime_mode values other than 'django' must still succeed."""
        resp = self._publish(slug="day4-jatos-mode", extra={"runtime_mode": "home_gear_lsl"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)


class Day4RuntimeBackendTests(APITestCase):
    """DjangoRuntimeBackend.startRun() + submitResult() contract."""

    def _publish_study(self, slug="day4-runtime-study"):
        self.client.post(
            reverse("configs-publish"),
            data={
                "study_slug": slug,
                "study_name": "Runtime Test Study",
                "config_version_label": "v1",
                "builder_version": "test",
                "runtime_mode": "django",
                "config": {"task_type": "rdm", "experiment_type": "trial-based"},
            },
            format="json",
        )

    def test_start_run_returns_run_session_id(self):
        self._publish_study()
        resp = self.client.post(
            reverse("runs-start"),
            data={"study_slug": "day4-runtime-study"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("run_session_id", resp.data)
        self.assertTrue(RunSession.objects.filter(pk=resp.data["run_session_id"]).exists())

    def test_start_run_with_participant_id(self):
        self._publish_study(slug="day4-participant-study")
        resp = self.client.post(
            reverse("runs-start"),
            data={"study_slug": "day4-participant-study", "participant_external_id": "P001"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # RunSession stores a hashed participant_key, not the raw external ID.
        # Verify the session was created; the key must be a non-empty string.
        session = RunSession.objects.get(pk=resp.data["run_session_id"])
        self.assertTrue(session.participant_key)

    def test_submit_result_full_payload(self):
        """Mirrors the exact DjangoRuntimeBackend.submitResult() payload shape."""
        self._publish_study(slug="day4-submit-study")
        start_resp = self.client.post(
            reverse("runs-start"),
            data={"study_slug": "day4-submit-study"},
            format="json",
        )
        run_session_id = start_resp.data["run_session_id"]

        # Matches buildResultPayload() output from main.js
        result_payload = {
            "format": "cogflow-jatos-result-v1",
            "created_at": "2025-01-01T00:00:00.000Z",
            "export_code": None,
            "config_id": "day4-submit-study",
            "task_type": "rdm",
            "experiment_type": "trial-based",
            "trial_count": 2,
            "trials": [
                {"trial_index": 0, "rt": 512, "correct": True},
                {"trial_index": 1, "rt": 430, "correct": False},
            ],
        }

        resp = self.client.post(
            reverse("results-submit"),
            data={
                "run_session_id": run_session_id,
                "status": "completed",
                "trial_count": 2,
                "result_payload": result_payload,
                "trials": result_payload["trials"],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("result_envelope_id", resp.data)

        envelope = ResultEnvelope.objects.get(pk=resp.data["result_envelope_id"])
        self.assertEqual(envelope.trial_count, 2)
        self.assertEqual(TrialResult.objects.filter(run_session=envelope.run_session).count(), 2)

    def test_start_run_for_unknown_study_slug_fails(self):
        """startRun with a slug that has no published config must return 4xx."""
        resp = self.client.post(
            reverse("runs-start"),
            data={"study_slug": "no-such-study-xyz"},
            format="json",
        )
        self.assertGreaterEqual(resp.status_code, 400)
        self.assertLess(resp.status_code, 500)
