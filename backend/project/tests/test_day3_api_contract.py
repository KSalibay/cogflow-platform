from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion
from apps.results.models import ResultEnvelope, TrialResult
from apps.runs.models import RunSession
from apps.studies.models import Study


class Day3ApiContractTests(APITestCase):
    def test_openapi_schema_endpoint(self) -> None:
        response = self.client.get(reverse("openapi-schema"), HTTP_ACCEPT="application/vnd.oai.openapi+json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("openapi", response.data)
        self.assertIn("paths", response.data)
        self.assertIn("/api/v1/configs/publish", response.data["paths"])
        self.assertIn("/api/v1/runs/start", response.data["paths"])
        self.assertIn("/api/v1/results/submit", response.data["paths"])

    def test_publish_start_submit_happy_path(self) -> None:
        publish_payload = {
            "study_slug": "rdm-day3",
            "study_name": "RDM Day 3",
            "config_version_label": "v1",
            "builder_version": "test-1.0",
            "runtime_mode": "home_gear_lsl",
            "config": {"task_type": "rdm", "experiment_type": "trial-based"},
        }

        publish_response = self.client.post(
            reverse("configs-publish"),
            data=publish_payload,
            format="json",
        )
        self.assertEqual(publish_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(publish_response.data["study_slug"], "rdm-day3")

        study = Study.objects.get(slug="rdm-day3")
        self.assertEqual(study.name, "RDM Day 3")
        self.assertEqual(study.runtime_mode, "home_gear_lsl")
        self.assertTrue(ConfigVersion.objects.filter(study=study, version_label="v1").exists())

        start_response = self.client.post(
            reverse("runs-start"),
            data={"study_slug": "rdm-day3", "participant_external_id": "P-123"},
            format="json",
        )
        self.assertEqual(start_response.status_code, status.HTTP_201_CREATED)

        run_session_id = start_response.data["run_session_id"]
        self.assertEqual(start_response.data["study_slug"], "rdm-day3")
        self.assertEqual(len(start_response.data["participant_key"]), 64)

        submit_payload = {
            "run_session_id": run_session_id,
            "status": "completed",
            "trial_count": 2,
            "result_summary": {"mean_rt": 350},
            "result_payload": {"raw": "payload"},
            "trials": [
                {
                    "trial_index": 0,
                    "task_name": "rdm",
                    "stimulus_key": "left",
                    "response_key": "left",
                    "rt_ms": 320,
                    "correct": True,
                },
                {
                    "trial_index": 1,
                    "task_name": "rdm",
                    "stimulus_key": "right",
                    "response_key": "left",
                    "rt_ms": 380,
                    "correct": False,
                },
            ],
        }
        submit_response = self.client.post(reverse("results-submit"), data=submit_payload, format="json")
        self.assertEqual(submit_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(submit_response.data["stored"])
        self.assertEqual(submit_response.data["trial_records_stored"], 2)

        run_session = RunSession.objects.get(id=run_session_id)
        self.assertEqual(run_session.status, "completed")
        self.assertIsNotNone(run_session.completed_at)

        envelope = ResultEnvelope.objects.get(run_session=run_session)
        self.assertEqual(envelope.trial_count, 2)
        self.assertEqual(envelope.key_version, "v1")
        self.assertEqual(envelope.encryption_alg, "fernet-256")

        self.assertEqual(TrialResult.objects.filter(run_session=run_session).count(), 2)
        self.assertTrue(
            AuditEvent.objects.filter(action="publish_config", resource_type="study").exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(action="start_run", resource_type="run_session").exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(action="submit_result", resource_type="run_session").exists()
        )

    def test_publish_is_update_safe_for_existing_study_slug(self) -> None:
        first_payload = {
            "study_slug": "same-study",
            "study_name": "Initial Name",
            "config_version_label": "v1",
            "builder_version": "1.0",
            "runtime_mode": "django",
            "config": {"task": "rdm"},
        }
        second_payload = {
            "study_slug": "same-study",
            "study_name": "Updated Name",
            "config_version_label": "v2",
            "builder_version": "1.1",
            "runtime_mode": "hybrid",
            "config": {"task": "rdm", "rev": 2},
        }

        self.client.post(reverse("configs-publish"), data=first_payload, format="json")
        response = self.client.post(reverse("configs-publish"), data=second_payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Study.objects.filter(slug="same-study").count(), 1)

        study = Study.objects.get(slug="same-study")
        self.assertEqual(study.name, "Updated Name")
        self.assertEqual(study.runtime_mode, "hybrid")
        self.assertTrue(ConfigVersion.objects.filter(study=study, version_label="v1").exists())
        self.assertTrue(ConfigVersion.objects.filter(study=study, version_label="v2").exists())

    def test_request_validation(self) -> None:
        bad_publish = self.client.post(reverse("configs-publish"), data={"study_name": "Missing slug"}, format="json")
        self.assertEqual(bad_publish.status_code, status.HTTP_400_BAD_REQUEST)

        bad_start = self.client.post(reverse("runs-start"), data={}, format="json")
        self.assertEqual(bad_start.status_code, status.HTTP_400_BAD_REQUEST)

        bad_submit = self.client.post(reverse("results-submit"), data={"status": "completed"}, format="json")
        self.assertEqual(bad_submit.status_code, status.HTTP_400_BAD_REQUEST)
