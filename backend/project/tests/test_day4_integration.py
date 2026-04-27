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

import pyotp
from django.contrib.auth.models import User
from django.core.management import call_command
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion
from apps.results.models import ResultEnvelope, TrialResult
from apps.runs.models import RunSession
from apps.studies.models import Study
from apps.users.services import get_or_create_profile


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


class Day5DashboardVisibilityTests(APITestCase):
    """Portal studies-list metrics for the first vertical integration demo."""

    def _publish_study(self, slug="day5-dashboard-study"):
        return self.client.post(
            reverse("configs-publish"),
            data={
                "study_slug": slug,
                "study_name": "Day 5 Dashboard Study",
                "config_version_label": "v1",
                "builder_version": "test",
                "runtime_mode": "django",
                "config": {"task_type": "rdm", "experiment_type": "trial-based"},
            },
            format="json",
        )

    def test_studies_list_includes_dashboard_fields(self):
        self._publish_study(slug="day5-fields")
        resp = self.client.get(reverse("studies-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("studies", resp.data)
        self.assertGreaterEqual(len(resp.data["studies"]), 1)

        row = next((s for s in resp.data["studies"] if s["study_slug"] == "day5-fields"), None)
        self.assertIsNotNone(row)
        self.assertIn("run_count", row)
        self.assertIn("last_result_at", row)
        self.assertIn("dashboard_url", row)
        self.assertEqual(row["run_count"], 0)
        self.assertIsNone(row["last_result_at"])

    def test_studies_list_updates_after_one_completed_run(self):
        slug = "day5-vertical"
        self._publish_study(slug=slug)

        start_resp = self.client.post(
            reverse("runs-start"),
            data={"study_slug": slug, "participant_external_id": "P-D5-001"},
            format="json",
        )
        self.assertEqual(start_resp.status_code, status.HTTP_201_CREATED)

        run_session_id = start_resp.data["run_session_id"]
        submit_resp = self.client.post(
            reverse("results-submit"),
            data={
                "run_session_id": run_session_id,
                "status": "completed",
                "trial_count": 1,
                "result_payload": {
                    "format": "cogflow-jatos-result-v1",
                    "trial_count": 1,
                    "trials": [{"trial_index": 0, "rt": 500, "correct": True}],
                },
                "trials": [{"trial_index": 0, "rt": 500, "correct": True}],
            },
            format="json",
        )
        self.assertEqual(submit_resp.status_code, status.HTTP_201_CREATED)

        studies_resp = self.client.get(reverse("studies-list"))
        self.assertEqual(studies_resp.status_code, status.HTTP_200_OK)
        row = next((s for s in studies_resp.data["studies"] if s["study_slug"] == slug), None)
        self.assertIsNotNone(row)
        self.assertGreaterEqual(row["run_count"], 1)
        self.assertIsNotNone(row["last_result_at"])

    def test_portal_dashboard_html_is_served(self):
        root_resp = self.client.get("/")
        self.assertEqual(root_resp.status_code, status.HTTP_200_OK)
        self.assertIn("text/html", root_resp["Content-Type"])

        index_resp = self.client.get("/index.html")
        self.assertEqual(index_resp.status_code, status.HTTP_200_OK)
        self.assertIn("CogFlow Portal", index_resp.content.decode("utf-8"))

    def test_interpreter_launch_html_is_served_with_platform_url(self):
        resp = self.client.get("/interpreter/index.html?launch=test-token")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        html = resp.content.decode("utf-8")
        self.assertIn("CogFlow Interpreter", html)
        self.assertIn("window.COGFLOW_PLATFORM_URL = 'http://testserver';", html)


class Day6PrivacyBaselineTests(APITestCase):
    """Day 6 checks: salted hash IDs, encrypted payload storage, and decrypt audit."""

    def _create_user_and_complete_mfa(self, username="day6_user"):
        user = User.objects.create_user(username=username, password="pass-1234")

        login_resp = self.client.post(
            reverse("auth-login"),
            data={"username": username, "password": "pass-1234"},
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)

        setup_resp = self.client.post(reverse("auth-mfa-setup"), data={}, format="json")
        self.assertEqual(setup_resp.status_code, status.HTTP_200_OK)
        secret = setup_resp.data["totp_secret"]

        code = pyotp.TOTP(secret).now()
        verify_resp = self.client.post(
            reverse("auth-mfa-verify"),
            data={"code": code},
            format="json",
        )
        self.assertEqual(verify_resp.status_code, status.HTTP_200_OK)
        return user

    def _publish_start_submit(self, slug="day6-privacy", participant_external_id="P-D6-001"):
        self.client.post(
            reverse("configs-publish"),
            data={
                "study_slug": slug,
                "study_name": "Day 6 Privacy Study",
                "config_version_label": "v1",
                "builder_version": "test",
                "runtime_mode": "django",
                "config": {"task_type": "rdm", "experiment_type": "trial-based"},
            },
            format="json",
        )

        start = self.client.post(
            reverse("runs-start"),
            data={"study_slug": slug, "participant_external_id": participant_external_id},
            format="json",
        )
        run_session_id = start.data["run_session_id"]

        result_payload = {
            "format": "cogflow-jatos-result-v1",
            "trial_count": 1,
            "trials": [{"trial_index": 0, "rt": 501, "correct": True}],
        }
        self.client.post(
            reverse("results-submit"),
            data={
                "run_session_id": run_session_id,
                "status": "completed",
                "trial_count": 1,
                "result_payload": result_payload,
                "trials": result_payload["trials"],
            },
            format="json",
        )

        run_session = RunSession.objects.get(id=run_session_id)
        envelope = ResultEnvelope.objects.get(run_session=run_session)
        return run_session, envelope, result_payload

    def test_participant_identifier_is_hashed_not_plaintext(self):
        raw_id = "P-D6-RAW-001"
        run_session, _, _ = self._publish_start_submit(participant_external_id=raw_id)
        self.assertNotEqual(run_session.participant_key, raw_id)
        self.assertEqual(len(run_session.participant_key), 64)
        self.assertNotIn(raw_id, run_session.participant_key)

    def test_result_payload_is_encrypted_at_rest(self):
        _, envelope, payload = self._publish_start_submit()
        self.assertTrue(envelope.encrypted_payload)
        self.assertNotIn('"format": "cogflow-jatos-result-v1"', envelope.encrypted_payload)
        self.assertNotIn(str(payload), envelope.encrypted_payload)

    def test_unauthorized_decrypt_is_denied_and_audited(self):
        run_session, _, _ = self._publish_start_submit(slug="day6-denied")
        resp = self.client.post(
            reverse("results-decrypt"),
            data={"run_session_id": run_session.id, "include_trials": True},
            format="json",
            HTTP_X_COGFLOW_ACTOR="researcher-denied",
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=str(run_session.id),
                actor="researcher-denied",
            ).exists()
        )

    def test_authorized_decrypt_returns_payload_and_audits(self):
        run_session, _, _ = self._publish_start_submit(slug="day6-allowed")
        self._create_user_and_complete_mfa(username="researcher_allowed")
        resp = self.client.post(
            reverse("results-decrypt"),
            data={"run_session_id": run_session.id, "include_trials": True},
            format="json",
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp.data["run_session_id"]), str(run_session.id))
        self.assertEqual(resp.data["result_payload"]["format"], "cogflow-jatos-result-v1")
        self.assertEqual(len(resp.data["trials"]), 1)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="decrypt_result",
                resource_type="run_session",
                resource_id=str(run_session.id),
                actor="researcher_allowed",
            ).exists()
        )

    def test_decrypt_requires_fresh_mfa_in_current_session(self):
        run_session, _, _ = self._publish_start_submit(slug="day6-fresh-mfa")

        user = User.objects.create_user(username="no_mfa_yet", password="pass-1234")
        login_resp = self.client.post(
            reverse("auth-login"),
            data={"username": "no_mfa_yet", "password": "pass-1234"},
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)

        # User is authenticated but has not completed TOTP verification in this session.
        resp = self.client.post(
            reverse("results-decrypt"),
            data={"run_session_id": run_session.id},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=str(run_session.id),
                actor=user.username,
            ).exists()
        )

    def test_totp_enrollment_persists_per_user_across_sessions(self):
        user = User.objects.create_user(username="persist_mfa", password="pass-1234")

        login1 = self.client.post(
            reverse("auth-login"),
            data={"username": "persist_mfa", "password": "pass-1234"},
            format="json",
        )
        self.assertEqual(login1.status_code, status.HTTP_200_OK)
        self.assertFalse(login1.data["mfa_enabled"])

        setup1 = self.client.post(reverse("auth-mfa-setup"), data={}, format="json")
        self.assertEqual(setup1.status_code, status.HTTP_200_OK)
        secret_1 = setup1.data["totp_secret"]

        code_1 = pyotp.TOTP(secret_1).now()
        verify1 = self.client.post(
            reverse("auth-mfa-verify"),
            data={"code": code_1},
            format="json",
        )
        self.assertEqual(verify1.status_code, status.HTTP_200_OK)
        self.assertTrue(verify1.data["mfa_enabled"])

        self.client.post(reverse("auth-logout"), data={}, format="json")

        login2 = self.client.post(
            reverse("auth-login"),
            data={"username": "persist_mfa", "password": "pass-1234"},
            format="json",
        )
        self.assertEqual(login2.status_code, status.HTTP_200_OK)
        self.assertTrue(login2.data["mfa_enabled"])

        # Setup should return the same persisted secret when regenerate=false.
        setup2 = self.client.post(reverse("auth-mfa-setup"), data={}, format="json")
        self.assertEqual(setup2.status_code, status.HTTP_200_OK)
        self.assertEqual(setup2.data["totp_secret"], secret_1)

        # But decrypt still requires fresh MFA verification after login.
        run_session, _, _ = self._publish_start_submit(slug="day6-persist-mfa")
        decrypt_before_verify = self.client.post(
            reverse("results-decrypt"),
            data={"run_session_id": run_session.id},
            format="json",
        )
        self.assertEqual(decrypt_before_verify.status_code, status.HTTP_403_FORBIDDEN)

        code_2 = pyotp.TOTP(secret_1).now()
        verify2 = self.client.post(
            reverse("auth-mfa-verify"),
            data={"code": code_2},
            format="json",
        )
        self.assertEqual(verify2.status_code, status.HTTP_200_OK)

        decrypt_after_verify = self.client.post(
            reverse("results-decrypt"),
            data={"run_session_id": run_session.id},
            format="json",
        )
        self.assertEqual(decrypt_after_verify.status_code, status.HTTP_200_OK)

        user.refresh_from_db()
        self.assertTrue(user.profile.mfa_enabled)
        self.assertTrue(bool(user.profile.mfa_totp_secret_encrypted))


class Day7PortalMvpLinkPipelineTests(APITestCase):
    """Portal MVP tests: roles, researcher links, participant launch flow."""

    def setUp(self):
        super().setUp()
        self.researcher = User.objects.create_user(username="r_owner", password="pass-1234")
        self.other_researcher = User.objects.create_user(username="r_other", password="pass-1234")
        self.admin = User.objects.create_user(username="r_admin", password="pass-1234")

        researcher_profile = get_or_create_profile(self.researcher)
        other_profile = get_or_create_profile(self.other_researcher)
        admin_profile = get_or_create_profile(self.admin)

        researcher_profile.role = researcher_profile.ROLE_RESEARCHER
        researcher_profile.save(update_fields=["role"])
        other_profile.role = other_profile.ROLE_RESEARCHER
        other_profile.save(update_fields=["role"])
        admin_profile.role = admin_profile.ROLE_ADMIN
        admin_profile.save(update_fields=["role"])

    def _publish_as(self, user, slug="portal-mvp-study"):
        self.client.force_authenticate(user=user)
        resp = self.client.post(
            reverse("configs-publish"),
            data={
                "study_slug": slug,
                "study_name": "Portal MVP Study",
                "config_version_label": "v1",
                "builder_version": "test",
                "runtime_mode": "django",
                "config": {"task_type": "rdm", "experiment_type": "trial-based"},
            },
            format="json",
        )
        self.client.force_authenticate(user=None)
        return resp

    def test_publish_sets_study_owner_from_authenticated_researcher(self):
        resp = self._publish_as(self.researcher, slug="owner-binding")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["owner_username"], "r_owner")
        study = Study.objects.get(slug="owner-binding")
        self.assertEqual(study.owner_user, self.researcher)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="publish_config",
                resource_type="study",
                actor="r_owner",
                metadata_json__version_label="v1",
            ).exists()
        )

    def test_researcher_can_generate_participant_launch_link(self):
        self._publish_as(self.researcher, slug="link-generation")

        self.client.force_authenticate(user=self.researcher)
        resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "link-generation"}),
            data={"participant_external_id": "P-LINK-001", "expires_in_hours": 24},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("launch_token", resp.data)
        self.assertIn("launch_url", resp.data)
        self.assertIn("launch_options", resp.data)
        self.assertIn("multi_use", resp.data["launch_options"])
        self.assertIn("single_use", resp.data["launch_options"])
        self.assertEqual(resp.data["owner_username"], "r_owner")
        self.assertTrue(
            AuditEvent.objects.filter(
                action="create_participant_link",
                resource_type="study",
                actor="r_owner",
                metadata_json__study_slug="link-generation",
            ).exists()
        )

    def test_non_owner_researcher_cannot_generate_links(self):
        self._publish_as(self.researcher, slug="owner-only-links")

        self.client.force_authenticate(user=self.other_researcher)
        resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "owner-only-links"}),
            data={"participant_external_id": "P-BLOCKED"},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_start_run_accepts_launch_token_and_persists_owner_association(self):
        self._publish_as(self.researcher, slug="pipeline-study")

        self.client.force_authenticate(user=self.researcher)
        link_resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "pipeline-study"}),
            data={"participant_external_id": "P-PIPE-001"},
            format="json",
        )
        self.client.force_authenticate(user=None)
        self.assertEqual(link_resp.status_code, status.HTTP_201_CREATED)

        launch_token = link_resp.data["launch_token"]
        start_resp = self.client.post(
            reverse("runs-start"),
            data={"launch_token": launch_token},
            format="json",
        )
        self.assertEqual(start_resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(start_resp.data["owner_username"], "r_owner")
        self.assertEqual(start_resp.data["study_slug"], "pipeline-study")
        self.assertIn("config", start_resp.data)
        self.assertEqual(start_resp.data["config"]["task_type"], "rdm")

        run_session_id = start_resp.data["run_session_id"]
        submit_resp = self.client.post(
            reverse("results-submit"),
            data={
                "run_session_id": run_session_id,
                "status": "completed",
                "trial_count": 1,
                "result_payload": {
                    "format": "cogflow-jatos-result-v1",
                    "trial_count": 1,
                    "trials": [{"trial_index": 0, "rt": 420, "correct": True}],
                },
                "trials": [{"trial_index": 0, "rt": 420, "correct": True}],
            },
            format="json",
        )
        self.assertEqual(submit_resp.status_code, status.HTTP_201_CREATED)

        run = RunSession.objects.get(id=run_session_id)
        self.assertEqual(run.study.slug, "pipeline-study")
        self.assertEqual(run.owner_user, self.researcher)

    def test_single_use_token_allows_only_one_start(self):
        self._publish_as(self.researcher, slug="single-use-study")

        self.client.force_authenticate(user=self.researcher)
        link_resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "single-use-study"}),
            data={"participant_external_id": "P-SINGLE-001"},
            format="json",
        )
        self.client.force_authenticate(user=None)
        self.assertEqual(link_resp.status_code, status.HTTP_201_CREATED)

        single_token = link_resp.data["launch_options"]["single_use"]["launch_token"]

        first_start = self.client.post(
            reverse("runs-start"),
            data={"launch_token": single_token},
            format="json",
        )
        self.assertEqual(first_start.status_code, status.HTTP_201_CREATED)

        second_start = self.client.post(
            reverse("runs-start"),
            data={"launch_token": single_token},
            format="json",
        )
        self.assertEqual(second_start.status_code, status.HTTP_409_CONFLICT)

    def test_multi_use_token_can_start_multiple_runs(self):
        self._publish_as(self.researcher, slug="multi-use-study")

        self.client.force_authenticate(user=self.researcher)
        link_resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "multi-use-study"}),
            data={"participant_external_id": "P-MULTI-001"},
            format="json",
        )
        self.client.force_authenticate(user=None)
        self.assertEqual(link_resp.status_code, status.HTTP_201_CREATED)

        multi_token = link_resp.data["launch_options"]["multi_use"]["launch_token"]

        first_start = self.client.post(
            reverse("runs-start"),
            data={"launch_token": multi_token},
            format="json",
        )
        self.assertEqual(first_start.status_code, status.HTTP_201_CREATED)

        second_start = self.client.post(
            reverse("runs-start"),
            data={"launch_token": multi_token},
            format="json",
        )
        self.assertEqual(second_start.status_code, status.HTTP_201_CREATED)

    def test_platform_admin_can_reassign_study_owner(self):
        self._publish_as(self.researcher, slug="owner-reassign")

        self.client.force_authenticate(user=self.admin)
        assign_resp = self.client.post(
            reverse("studies-assign-owner", kwargs={"study_slug": "owner-reassign"}),
            data={"owner_username": "r_other"},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(assign_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(assign_resp.data["owner_username"], "r_other")

        study = Study.objects.get(slug="owner-reassign")
        self.assertEqual(study.owner_user, self.other_researcher)

    def test_non_admin_cannot_reassign_study_owner(self):
        self._publish_as(self.researcher, slug="owner-reassign-blocked")

        self.client.force_authenticate(user=self.other_researcher)
        assign_resp = self.client.post(
            reverse("studies-assign-owner", kwargs={"study_slug": "owner-reassign-blocked"}),
            data={"owner_username": "r_other"},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(assign_resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_researcher_studies_list_is_scoped_to_owner(self):
        self._publish_as(self.researcher, slug="scope-a")
        self._publish_as(self.other_researcher, slug="scope-b")

        self.client.force_authenticate(user=self.researcher)
        resp = self.client.get(reverse("studies-list"))
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        slugs = {row["study_slug"] for row in resp.data["studies"]}
        self.assertIn("scope-a", slugs)
        self.assertNotIn("scope-b", slugs)

    def test_owner_can_list_recent_runs_for_study(self):
        self._publish_as(self.researcher, slug="results-dashboard")

        self.client.force_authenticate(user=self.researcher)
        link_resp = self.client.post(
            reverse("studies-participant-links", kwargs={"study_slug": "results-dashboard"}),
            data={"participant_external_id": "P-RESULT-001"},
            format="json",
        )
        self.client.force_authenticate(user=None)
        launch_token = link_resp.data["launch_token"]

        start_resp = self.client.post(reverse("runs-start"), data={"launch_token": launch_token}, format="json")
        self.assertEqual(start_resp.status_code, status.HTTP_201_CREATED)
        run_session_id = start_resp.data["run_session_id"]

        submit_resp = self.client.post(
            reverse("results-submit"),
            data={
                "run_session_id": run_session_id,
                "status": "completed",
                "trial_count": 1,
                "result_payload": {
                    "format": "cogflow-jatos-result-v1",
                    "trial_count": 1,
                    "trials": [{"trial_index": 0, "rt": 420, "correct": True}],
                },
                "trials": [{"trial_index": 0, "rt": 420, "correct": True}],
            },
            format="json",
        )
        self.assertEqual(submit_resp.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.researcher)
        runs_resp = self.client.get(reverse("studies-runs", kwargs={"study_slug": "results-dashboard"}))
        self.client.force_authenticate(user=None)

        self.assertEqual(runs_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(runs_resp.data["study_slug"], "results-dashboard")
        self.assertEqual(len(runs_resp.data["runs"]), 1)
        self.assertTrue(runs_resp.data["runs"][0]["has_result"])
        self.assertEqual(runs_resp.data["runs"][0]["trial_count"], 1)

    def test_non_owner_cannot_list_runs_for_study(self):
        self._publish_as(self.researcher, slug="results-private")

        self.client.force_authenticate(user=self.other_researcher)
        runs_resp = self.client.get(reverse("studies-runs", kwargs={"study_slug": "results-private"}))
        self.client.force_authenticate(user=None)

        self.assertEqual(runs_resp.status_code, status.HTTP_403_FORBIDDEN)


class Day8PlatformAdminUserManagementTests(APITestCase):
    """Platform admin user management endpoints."""

    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(username="platform_admin_1", password="pass-1234")
        self.researcher = User.objects.create_user(username="researcher_1", password="pass-1234")

        admin_profile = get_or_create_profile(self.admin)
        admin_profile.role = admin_profile.ROLE_ADMIN
        admin_profile.save(update_fields=["role"])

        researcher_profile = get_or_create_profile(self.researcher)
        researcher_profile.role = researcher_profile.ROLE_RESEARCHER
        researcher_profile.save(update_fields=["role"])

    def test_admin_can_list_users(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get(reverse("admin-users"))
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("users", resp.data)
        usernames = {u["username"] for u in resp.data["users"]}
        self.assertIn("platform_admin_1", usernames)
        self.assertIn("researcher_1", usernames)

    def test_non_admin_cannot_list_users(self):
        self.client.force_authenticate(user=self.researcher)
        resp = self.client.get(reverse("admin-users"))
        self.client.force_authenticate(user=None)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_user_with_role(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            reverse("admin-users"),
            data={
                "username": "analyst_new",
                "password": "pass-1234",
                "email": "analyst_new@example.com",
                "role": "analyst",
                "is_active": True,
            },
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        created = User.objects.get(username="analyst_new")
        self.assertEqual(created.profile.role, "analyst")

    def test_admin_can_update_role_and_delete_user(self):
        target = User.objects.create_user(username="participant_to_manage", password="pass-1234")
        target_profile = get_or_create_profile(target)
        target_profile.role = target_profile.ROLE_PARTICIPANT
        target_profile.save(update_fields=["role"])

        self.client.force_authenticate(user=self.admin)
        role_resp = self.client.post(
            reverse("admin-user-role", kwargs={"user_id": target.id}),
            data={"role": "researcher"},
            format="json",
        )
        delete_resp = self.client.post(
            reverse("admin-user-delete", kwargs={"user_id": target.id}),
            data={},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(role_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(delete_resp.status_code, status.HTTP_200_OK)
        self.assertFalse(User.objects.filter(id=target.id).exists())

    def test_admin_can_deactivate_and_reactivate_user(self):
        target = User.objects.create_user(username="toggle_me", password="pass-1234")

        self.client.force_authenticate(user=self.admin)
        deactivate_resp = self.client.post(
            reverse("admin-user-activation", kwargs={"user_id": target.id}),
            data={"is_active": False},
            format="json",
        )
        reactivate_resp = self.client.post(
            reverse("admin-user-activation", kwargs={"user_id": target.id}),
            data={"is_active": True},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(deactivate_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(reactivate_resp.status_code, status.HTTP_200_OK)

        target.refresh_from_db()
        self.assertTrue(target.is_active)

    def test_admin_cannot_deactivate_self(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            reverse("admin-user-activation", kwargs={"user_id": self.admin.id}),
            data={"is_active": False},
            format="json",
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class Day8AnalysisReportJobTests(APITestCase):
    """Phase 2 smoke tests for queued analysis report jobs and artifacts."""

    def setUp(self):
        super().setUp()
        self.researcher = User.objects.create_user(username="report_owner", password="pass-1234")
        profile = get_or_create_profile(self.researcher)
        profile.role = profile.ROLE_RESEARCHER
        profile.save(update_fields=["role"])

    def _publish_owned_study(self, slug="day8-report-study"):
        self.client.force_authenticate(user=self.researcher)
        resp = self.client.post(
            reverse("configs-publish"),
            data={
                "study_slug": slug,
                "study_name": "Day 8 Report Study",
                "config_version_label": "v1",
                "builder_version": "test",
                "runtime_mode": "django",
                "config": {"task_type": "rdm", "experiment_type": "trial-based"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        return slug

    def test_report_job_renders_markdown_html_and_pdf_artifacts(self):
        slug = self._publish_owned_study()

        create_resp = self.client.post(
            reverse("studies-analysis-jobs"),
            data={
                "study_slug": slug,
                "engine": "python",
                "requested_formats": ["markdown", "html", "pdf", "snapshot"],
                "include_completed_only": True,
                "options": {"include_overview": True, "include_numeric_summary": True},
            },
            format="json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_202_ACCEPTED)
        job_id = create_resp.data["job"]["id"]

        call_command("process_report_jobs")

        detail_resp = self.client.get(reverse("studies-analysis-job-detail", kwargs={"job_id": job_id}))
        self.assertEqual(detail_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_resp.data["job"]["status"], "succeeded")
        artifact_formats = {artifact["format"] for artifact in detail_resp.data["job"]["artifacts"]}
        self.assertTrue({"markdown", "html", "pdf", "snapshot"}.issubset(artifact_formats))

        markdown_resp = self.client.get(
            reverse("studies-analysis-job-artifact", kwargs={"job_id": job_id, "artifact_format": "markdown"})
        )
        self.assertEqual(markdown_resp.status_code, status.HTTP_200_OK)
        self.assertIn("Study Analysis Report", markdown_resp.content.decode("utf-8"))

        pdf_resp = self.client.get(
            reverse("studies-analysis-job-artifact", kwargs={"job_id": job_id, "artifact_format": "pdf"})
        )
        self.assertEqual(pdf_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf_resp["Content-Type"], "application/pdf")
        self.assertGreater(len(pdf_resp.content), 100)

    def test_queued_job_can_be_cancelled(self):
        slug = self._publish_owned_study(slug="day9-cancel-study")
        create_resp = self.client.post(
            reverse("studies-analysis-jobs"),
            data={"study_slug": slug, "engine": "python"},
            format="json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_202_ACCEPTED)
        job_id = create_resp.data["job"]["id"]

        cancel_resp = self.client.post(
            reverse("studies-analysis-job-cancel", kwargs={"job_id": job_id})
        )
        self.assertEqual(cancel_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(cancel_resp.data["job"]["status"], "failed")
        self.assertIn("Cancelled", cancel_resp.data["job"]["error_message"])

    def test_rate_limit_blocks_excess_jobs(self):
        slug = self._publish_owned_study(slug="day9-ratelimit-study")
        for _ in range(5):
            self.client.post(
                reverse("studies-analysis-jobs"),
                data={"study_slug": slug, "engine": "python"},
                format="json",
            )
        sixth_resp = self.client.post(
            reverse("studies-analysis-jobs"),
            data={"study_slug": slug, "engine": "python"},
            format="json",
        )
        self.assertEqual(sixth_resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_task_family_detected_from_slug(self):
        from project.study_report_jobs import _detect_task_family
        self.assertEqual(_detect_task_family("KAMI135-rdm-01", []), "rdm")
        self.assertEqual(_detect_task_family("ABC1234-flanker-01", []), "flanker")
        self.assertEqual(_detect_task_family("AAA1111-sart-01", []), "sart")
        self.assertEqual(_detect_task_family("AMI1111-gabor-01", []), "gabor")
        self.assertEqual(_detect_task_family("something-unknown-01", []), "generic")
