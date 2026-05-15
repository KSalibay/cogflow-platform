from .api_views_common import *

class StartRunView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = StartRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        token_payload = {}
        study = None
        owner_username = None
        launch_mode = None
        launch_token_digest = None
        counterbalance_enabled = True
        use_flow_variants = False
        requested_task_order = []
        task_order_strict = False

        launch_token = data.get("launch_token")
        if launch_token:
            try:
                token_payload = _read_launch_token(launch_token)
            except signing.BadSignature:
                return Response({"error": "Launch token invalid"}, status=status.HTTP_400_BAD_REQUEST)

            exp_text = token_payload.get("expires_at")
            try:
                exp_dt = timezone.datetime.fromisoformat(exp_text)
                if timezone.is_naive(exp_dt):
                    exp_dt = timezone.make_aware(exp_dt)
            except Exception:
                return Response({"error": "Launch token malformed"}, status=status.HTTP_400_BAD_REQUEST)

            if timezone.now() >= exp_dt:
                return Response({"error": "Launch token expired"}, status=status.HTTP_410_GONE)

            study_slug = (token_payload.get("study_slug") or "").strip()
            owner_username = (token_payload.get("researcher_username") or "").strip() or None
            launch_mode = (token_payload.get("launch_mode") or "multi_use").strip()
            launch_token_digest = _launch_token_digest(launch_token)
            counterbalance_enabled = bool(token_payload.get("counterbalance_enabled", True))
            use_flow_variants = bool(token_payload.get("use_flow_variants", False))
            requested_task_order = token_payload.get("task_order") if isinstance(token_payload.get("task_order"), list) else []
            task_order_strict = bool(token_payload.get("task_order_strict", False))

            if launch_mode == "single_use":
                already_used = AuditEvent.objects.filter(
                    action="start_run",
                    resource_type="run_session",
                    metadata_json__launch_token_digest=launch_token_digest,
                ).exists()
                if already_used:
                    return Response({"error": "Single-use launch token already consumed"}, status=status.HTTP_409_CONFLICT)

            study = Study.objects.filter(slug=study_slug, is_active=True).first()
        elif data.get("study_slug"):
            study = Study.objects.filter(slug=data["study_slug"], is_active=True).first()

        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        participant_external_id = (
            data.get("participant_external_id")
            or (token_payload.get("participant_external_id") if launch_token else "")
            or ""
        )
        participant_external_id = str(participant_external_id).strip()
        if not participant_external_id:
            # Keep anonymous launches counterbalanced across runs even when no
            # external participant identifier is provided.
            participant_external_id = f"anonymous-{uuid4().hex}"
        participant_key = hash_identifier(participant_external_id)

        config_versions = list(study.config_versions.all())
        if not config_versions:
            return Response({"error": "No published config version"}, status=status.HTTP_400_BAD_REQUEST)

        requested_ids = []
        requested_ids_seen = set()
        for raw in requested_task_order:
            sid = str(raw or "").strip()
            if not sid or sid in requested_ids_seen:
                continue
            requested_ids.append(sid)
            requested_ids_seen.add(sid)

        selected_versions = config_versions
        if task_order_strict and requested_ids:
            requested_set = set(requested_ids)
            selected_versions = [cv for cv in config_versions if str(cv.id) in requested_set]
            if not selected_versions:
                return Response(
                    {"error": "Requested task selection does not match any published config versions"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        permutations_total = 1
        permutation_index = 0
        counterbalance_mode = "fixed"
        selected_flow_variant = None

        if use_flow_variants:
            try:
                selected_flow_variant, study_properties, permutation_index = _select_study_flow_variant(
                    study,
                    config_versions,
                    launch_token_digest,
                )
            except ValueError as err:
                return Response({"error": str(err)}, status=status.HTTP_400_BAD_REQUEST)

            if not selected_flow_variant:
                return Response({"error": "No saved study variants are available for this link"}, status=status.HTTP_400_BAD_REQUEST)

            variant_lookup = {str(cv.id): cv for cv in config_versions}
            ordered_versions = [variant_lookup[sid] for sid in selected_flow_variant["task_order"] if sid in variant_lookup]
            if not ordered_versions:
                return Response({"error": "Selected study variant does not match any published config versions"}, status=status.HTTP_400_BAD_REQUEST)

            requested_ids = list(selected_flow_variant["task_order"])
            task_order_strict = True
            counterbalance_enabled = False
            counterbalance_mode = "study_flow_variant"
            permutations_total = len(study_properties.get("flow_variants") or [])
        elif counterbalance_enabled:
            ordered_versions, permutation_index, permutations_total = _counterbalanced_config_order(
                selected_versions,
                seed=participant_external_id,
            )
            counterbalance_mode = "permutation_by_participant_strict" if task_order_strict and requested_ids else "permutation_by_participant"
        else:
            ordered_versions = _ordered_config_versions_by_ids(selected_versions, requested_ids)
            if task_order_strict and requested_ids:
                counterbalance_mode = "manual_order_strict"
            else:
                counterbalance_mode = "manual_order" if requested_ids else "fixed"

        config_version = ordered_versions[0]

        configs_payload = []
        available_task_types = []
        for cv in ordered_versions:
            task_type = _extract_config_task_type(cv.config_json)
            if task_type and task_type not in available_task_types:
                available_task_types.append(task_type)
            configs_payload.append(
                {
                    "config_version_id": cv.id,
                    "config_version_label": cv.version_label,
                    "task_type": task_type,
                    "config": cv.config_json,
                }
            )

        owner_user = study.owner_user
        if not owner_user and owner_username:
            owner_user = User.objects.filter(username=owner_username).first()

        owner_name_response = owner_user.username if owner_user else owner_username

        run_session = RunSession.objects.create(
            study=study,
            config_version=config_version,
            owner_user=owner_user,
            flow_variant_id=selected_flow_variant["id"] if selected_flow_variant else "",
            flow_variant_label=selected_flow_variant["label"] if selected_flow_variant else "",
            has_flow_variant=bool(selected_flow_variant),
            participant_key=participant_key,
            status="started",
        )

        completion_redirect_url = _resolve_redirect_url(
            token_payload.get("completion_redirect_url") if launch_token else None,
            participant_external_id,
            participant_key,
            run_session.id,
        )
        abort_redirect_url = _resolve_redirect_url(
            token_payload.get("abort_redirect_url") if launch_token else None,
            participant_external_id,
            participant_key,
            run_session.id,
        )
        prolific_completion_mode = (
            (token_payload.get("prolific_completion_mode") if launch_token else None)
            or "default"
        )
        prolific_completion_code = (
            (token_payload.get("prolific_completion_code") if launch_token else None)
            or ""
        )

        record_audit(
            action="start_run",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "study_slug": study.slug,
                "owner_username": owner_name_response,
                "launch_mode": launch_mode,
                "launch_token_digest": launch_token_digest,
                "config_versions_count": len(config_versions),
                "counterbalance_enabled": counterbalance_enabled,
                "counterbalance_mode": counterbalance_mode,
                "counterbalance_permutation_index": permutation_index,
                "counterbalance_permutations_total": permutations_total,
                "use_flow_variants": use_flow_variants,
                "flow_variant_id": selected_flow_variant["id"] if selected_flow_variant else None,
                "flow_variant_label": selected_flow_variant["label"] if selected_flow_variant else None,
                "task_order_strict": task_order_strict,
                "task_order_count": len(requested_ids),
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
                "prolific_completion_mode": prolific_completion_mode,
                "has_prolific_completion_code": bool(prolific_completion_code),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": study.slug,
                "config_version_id": config_version.id,
                "config": config_version.config_json,
                "configs": configs_payload,
                "available_task_types": available_task_types,
                "counterbalance": {
                    "mode": counterbalance_mode,
                    "enabled": counterbalance_enabled,
                    "task_order_strict": task_order_strict,
                    "seed_source": "participant_external_id",
                    "permutation_index": permutation_index,
                    "permutations_total": permutations_total,
                    "use_flow_variants": use_flow_variants,
                    "flow_variant_id": selected_flow_variant["id"] if selected_flow_variant else None,
                    "flow_variant_label": selected_flow_variant["label"] if selected_flow_variant else None,
                },
                "participant_key": participant_key,
                "owner_username": owner_name_response,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "prolific_completion_mode": prolific_completion_mode,
                "prolific_completion_code": prolific_completion_code,
            },
            status=status.HTTP_201_CREATED,
        )


class SubmitResultView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = SubmitResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        envelope = store_result_envelope(
            run_session=run_session,
            trial_count=data["trial_count"],
            summary_json=data.get("result_summary", {}),
            result_payload=data["result_payload"],
        )

        trial_records_stored = store_trial_results(
            run_session=run_session,
            trials=data.get("trials", []),
        )

        run_session.status = data["status"]
        if data["status"] == RUN_STATUS_COMPLETED:
            run_session.completed_at = timezone.now()
        run_session.save(update_fields=["status", "completed_at"])

        record_audit(
            action="submit_result",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "status": run_session.status,
                "trial_count": data["trial_count"],
                "trial_records_stored": trial_records_stored,
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "result_envelope_id": envelope.id,
                "status": run_session.status,
                "stored": True,
                "trial_records_stored": trial_records_stored,
            },
            status=status.HTTP_201_CREATED,
        )


class DecryptResultView(APIView):
    """Protected decrypt/read endpoint for interim Day 6 privacy controls."""

    @transaction.atomic
    def post(self, request):
        serializer = DecryptResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)

        if not request.user.is_authenticated:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "unauthenticated",
                    "include_trials": data.get("include_trials", False),
                },
            )
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        mfa_enabled = bool(profile.mfa_enabled)
        if not mfa_enabled or not _is_mfa_session_fresh(request):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "mfa_required",
                    "mfa_enabled": mfa_enabled,
                },
            )
            return Response({"error": "MFA verification required"}, status=status.HTTP_403_FORBIDDEN)

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={"reason": "run_session_not_found"},
            )
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        study = getattr(run_session, "study", None)
        is_legacy_public = _is_legacy_public_study(study)
        if not study or (not is_legacy_public and not _has_study_access(study, request.user, profile)):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "study_access_denied"},
            )
            return Response({"error": "Study is not shared with the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        perms = _study_access_permissions(study, request.user, profile)
        if (not is_legacy_public) and (not perms.get("can_view_full_payload")):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "full_payload_not_permitted"},
            )
            return Response({"error": "Full payload access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)

        envelope = getattr(run_session, "result_envelope", None)
        if not envelope:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "result_envelope_not_found"},
            )
            return Response({"error": "Result envelope not found"}, status=status.HTTP_404_NOT_FOUND)

        result_payload = get_decrypted_envelope(envelope)
        include_trials = data.get("include_trials", False)
        trials = []
        if include_trials:
            for trial in run_session.trial_results.all().order_by("trial_index"):
                trials.append(get_decrypted_trial(trial))

        record_audit(
            action="decrypt_result",
            resource_type="run_session",
            resource_id=run_session.id,
            actor=actor,
            metadata={
                "include_trials": include_trials,
                "trial_records_returned": len(trials),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": run_session.study.slug,
                "status": run_session.status,
                "result_payload": result_payload,
                "trials": trials if include_trials else None,
            },
            status=status.HTTP_200_OK,
        )
