import json
import logging
import math
import re
from io import BytesIO

from django.db import transaction
from django.utils import timezone
from markdown import markdown as markdown_to_html

logger = logging.getLogger(__name__)

from apps.results.services import get_decrypted_trial
from apps.studies.models import StudyAnalysisReportArtifact, StudyAnalysisReportJob
from project.constants import RUN_STATUS_COMPLETED


def _flatten_numeric_fields(payload, prefix=""):
    out = {}
    if isinstance(payload, dict):
        for key, val in payload.items():
            field_name = f"{prefix}.{key}" if prefix else str(key)
            out.update(_flatten_numeric_fields(val, field_name))
        return out
    if isinstance(payload, list):
        return out
    if isinstance(payload, bool):
        out[prefix] = 1.0 if payload else 0.0
        return out
    if isinstance(payload, str):
        s = payload.strip().lower()
        if s == "true":
            out[prefix] = 1.0
            return out
        if s == "false":
            out[prefix] = 0.0
            return out
    if isinstance(payload, (int, float)):
        if isinstance(payload, float) and (math.isnan(payload) or math.isinf(payload)):
            return out
        out[prefix] = float(payload)
    return out


def _describe_series(values):
    clean = [float(v) for v in values if isinstance(v, (int, float)) and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))]
    n = len(clean)
    if n == 0:
        return {"n": 0, "mean": None, "sd": None, "min": None, "max": None}
    mean = sum(clean) / n
    if n > 1:
        var = sum((x - mean) ** 2 for x in clean) / (n - 1)
        sd = math.sqrt(var)
    else:
        sd = 0.0
    return {
        "n": n,
        "mean": mean,
        "sd": sd,
        "min": min(clean),
        "max": max(clean),
    }


def _matches_interest(field_name: str, fields_of_interest: list[str]):
    field = str(field_name or "").strip().lower()
    if not field:
        return False
    interests = [str(x or "").strip().lower() for x in (fields_of_interest or []) if str(x or "").strip()]
    if not interests:
        return True
    parts = [p for p in re.split(r"[^a-z0-9]+", field) if p]
    parts_set = set(parts)
    for token in interests:
        if token == field:
            return True
        if token in parts_set:
            return True
        if token in field and ("_" in token or "." in token):
            return True
    return False


def _field_priority(field_name: str, fields_of_interest: list[str]):
    field = str(field_name or "").strip().lower()
    if not field:
        return -100

    exact_behavioral = {
        "rt", "rt_ms", "response_time", "reaction_time", "accuracy", "acc", "correct",
        "is_correct", "error", "errors", "score", "points", "reward_points_awarded",
        "commission_error", "omission_error", "choice", "response", "response_key",
    }
    behavioral_tokens = [
        "rt", "reaction", "response_time", "latency", "accuracy", "correct", "error",
        "commission", "omission", "score", "point", "reward", "choice", "response",
        "hit", "miss", "false_alarm", "dprime", "criterion",
    ]
    config_tokens = [
        "config", "parameter", "settings", "duration", "stimulus", "mask", "cue", "target",
        "orientation", "frequency", "contrast", "diameter", "border", "color", "position", "option",
        "probability", "adaptive", "quest", "iti", "trial_index", "block_index",
    ]

    if field in exact_behavioral:
        return 100
    if _matches_interest(field, fields_of_interest) and fields_of_interest:
        return 120
    if any(token and token in field for token in (fields_of_interest or [])):
        return 110

    score = 0
    if any(tok in field for tok in behavioral_tokens):
        score += 40
    if any(tok in field for tok in config_tokens):
        score -= 35
    if field.startswith("data."):
        score += 10
    return score


def _render_r_markdown(study, overview, summary_rows):
    lines = [
        "---",
        f'title: "CogFlow Study Report: {study.name} ({study.slug})"',
        "output: html_document",
        "---",
        "",
        "## Overview",
        "",
    ]
    for key, value in overview.items():
        lines.append(f"- **{key}**: {value}")
    lines.extend(["", "## Numeric Summary", "", "```{r}"])
    if summary_rows:
        lines.append("summary_df <- data.frame(")
        lines.append("  variable = c(")
        for index, row in enumerate(summary_rows):
            comma = "," if index < len(summary_rows) - 1 else ""
            lines.append(f"    \"{str(row['field']).replace('\\"', '\\\\"')}\"{comma}")
        lines.append("  ),")
        for col in ["n", "mean", "sd", "min", "max"]:
            lines.append(f"  {col} = c(")
            for index, row in enumerate(summary_rows):
                comma = "," if index < len(summary_rows) - 1 else ""
                lines.append(f"    {row[col]}{comma}")
            lines.append("  ),")
        lines[-1] = lines[-1].rstrip(",")
        lines.extend([")", "print(summary_df)"])
    else:
        lines.extend([
            'summary_df <- data.frame(note = "No numeric variables available")',
            "print(summary_df)",
        ])
    lines.append("```")
    return "\n".join(lines)


def _detect_task_family(study_slug: str, summary_rows: list) -> str:
    """Infer the cognitive task family from the study slug and/or variable names."""
    slug = (study_slug or "").lower()
    fields_lower = {str(r.get("field", "")).lower() for r in summary_rows}

    if any(tok in slug for tok in ("rdm", "rdk", "dot-motion", "dotmotion", "random-dot")):
        return "rdm"
    if any(tok in slug for tok in ("flanker", "eriksen")):
        return "flanker"
    if any(tok in slug for tok in ("sart", "sustained-attention", "sustained_attention")):
        return "sart"
    if any(tok in slug for tok in ("nback", "n-back", "n_back")):
        return "nback"
    if any(tok in slug for tok in ("gabor", "contrast-detection", "orientation")):
        return "gabor"
    if any(tok in slug for tok in ("wcst", "card-sort", "cardsort")):
        return "wcst"
    if any(tok in slug for tok in ("stroop",)):
        return "stroop"
    if any(tok in slug for tok in ("drt", "detection-response")):
        return "drt"

    # Fall back to field-name heuristics
    if {"coherence", "motion_direction", "correct_direction"} & fields_lower:
        return "rdm"
    if {"congruent", "congruency", "flanker_type"} & fields_lower:
        return "flanker"
    if {"commission_error", "omission_error", "go_nogo"} & fields_lower:
        return "sart"
    if {"match", "nback_level", "target_match"} & fields_lower:
        return "nback"

    return "generic"


_TASK_FAMILY_LABELS = {
    "rdm": "Random Dot Motion (RDM)",
    "flanker": "Eriksen Flanker",
    "sart": "Sustained Attention to Response Task (SART)",
    "nback": "N-Back",
    "gabor": "Gabor Contrast Detection",
    "wcst": "Wisconsin Card Sorting Task (WCST)",
    "stroop": "Stroop",
    "drt": "Detection Response Task (DRT)",
    "generic": None,
}

_TASK_KEY_FIELDS = {
    "rdm": {
        "rt": "Reaction Time (ms)",
        "accuracy": "Accuracy",
        "correct": "Correct",
        "coherence": "Coherence (%)",
    },
    "flanker": {
        "rt": "Reaction Time (ms)",
        "accuracy": "Accuracy",
        "correct": "Correct",
        "congruent": "Congruent Trials",
    },
    "sart": {
        "rt": "Reaction Time (ms)",
        "commission_error": "Commission Errors",
        "omission_error": "Omission Errors",
        "correct": "Correct",
    },
    "nback": {
        "rt": "Reaction Time (ms)",
        "accuracy": "Accuracy",
        "correct": "Correct",
        "match": "Target Match",
    },
    "gabor": {
        "rt": "Reaction Time (ms)",
        "correct": "Correct",
        "accuracy": "Accuracy",
        "contrast": "Contrast",
    },
    "stroop": {
        "rt": "Reaction Time (ms)",
        "correct": "Correct",
        "congruent": "Congruent Trials",
    },
    "wcst": {
        "rt": "Reaction Time (ms)",
        "correct": "Correct",
        "perseverative_error": "Perseverative Errors",
    },
    "drt": {
        "rt": "Reaction Time (ms)",
        "correct": "Correct",
    },
}

_TASK_INTERPRETATION_NOTES = {
    "rdm": (
        "**Interpretation guidance (RDM):** "
        "Key metrics are mean RT and accuracy across coherence levels. "
        "Higher coherence should produce faster, more accurate responses. "
        "Accuracy near 50 % at zero coherence indicates chance-level performance. "
        "Large RT variance may reflect lapses in attention or stimulus uncertainty."
    ),
    "flanker": (
        "**Interpretation guidance (Flanker):** "
        "Compare RT and accuracy between congruent and incongruent trials. "
        "The congruency effect (incongruent minus congruent RT) is the primary index of executive control. "
        "Accuracy costs on incongruent trials suggest speed–accuracy trade-offs."
    ),
    "sart": (
        "**Interpretation guidance (SART):** "
        "Commission errors (responding to 'no-go' targets) reflect failures of inhibitory control. "
        "Omission errors (missing 'go' targets) may reflect attentional lapses. "
        "Mean RT provides a baseline processing speed estimate."
    ),
    "nback": (
        "**Interpretation guidance (N-Back):** "
        "Accuracy and RT on target-match trials index working memory capacity at each load level. "
        "Increasing errors with higher N indicates working memory limits. "
        "False-alarm rate should be reported alongside hit rate (d′ or similar)."
    ),
    "gabor": (
        "**Interpretation guidance (Gabor):** "
        "Psychometric threshold (75 % correct) is the primary outcome. "
        "Lower contrast thresholds indicate finer perceptual sensitivity. "
        "RT may increase near threshold due to decision uncertainty."
    ),
    "wcst": (
        "**Interpretation guidance (WCST):** "
        "Perseverative errors are the primary index of cognitive flexibility. "
        "Total correct responses index overall performance. "
        "High perseverative error counts suggest difficulty adapting to rule changes."
    ),
    "stroop": (
        "**Interpretation guidance (Stroop):** "
        "The interference effect (incongruent minus congruent RT) measures selective attention. "
        "Accuracy on incongruent trials indexes response conflict resolution."
    ),
    "drt": (
        "**Interpretation guidance (DRT):** "
        "Mean RT to the detection stimulus is the primary measure of residual attention. "
        "Values above 500 ms or high miss rates suggest cognitive overload."
    ),
}


def _render_task_section(task_family: str, summary_rows: list) -> str:
    """Return a markdown section with task-specific key metrics and interpretation notes."""
    label = _TASK_FAMILY_LABELS.get(task_family)
    if not label:
        return ""

    key_fields = _TASK_KEY_FIELDS.get(task_family, {})
    matched = [
        row for row in summary_rows
        if any(kf in str(row.get("field", "")).lower() for kf in key_fields)
    ]

    lines = [f"## Task Family: {label}", ""]
    if matched:
        lines.extend(["### Key Metrics", ""])
        lines.extend(["| Variable | N | Mean | SD | Min | Max |", "|---|---:|---:|---:|---:|---:|"])
        for row in matched:
            lines.append(
                f"| {row['field']} | {row['n']} | {row['mean']:.4f} | {row['sd']:.4f}"
                f" | {row['min']:.4f} | {row['max']:.4f} |"
            )
        lines.append("")

    note = _TASK_INTERPRETATION_NOTES.get(task_family, "")
    if note:
        lines.extend([note, ""])

    return "\n".join(lines)


def _render_markdown_report(study, engine, options, overview, coverage_rows, summary_rows, r_markdown_document=None):
    lines = [
        f"# Study Analysis Report: {study.name} ({study.slug})",
        "",
        f"Engine: {'R' if engine == 'r' else 'Python'}",
        f"Generated at: {timezone.now().isoformat()}",
        "",
    ]
    if options.get("include_overview", True):
        lines.extend(["## Overview", ""])
        for key, value in overview.items():
            lines.append(f"- {key}: {value}")
        lines.append("")
    if options.get("include_field_coverage", True):
        lines.extend(["## Field Coverage", ""])
        if not coverage_rows:
            lines.append("No numeric fields were found in the selected runs.")
        else:
            lines.extend(["| Variable | Type | Non-null Count |", "|---|---|---:|"])
            for row in coverage_rows:
                lines.append(f"| {row['field']} | {row.get('field_type', 'unknown')} | {row['count']} |")
        lines.append("")
    if options.get("include_numeric_summary", True):
        lines.extend(["## Numeric Summary", ""])
        if not summary_rows:
            lines.append("No numeric variables were available for descriptive statistics.")
        else:
            lines.extend(["| Variable | Type | N | Mean | SD | Min | Max |", "|---|---|---:|---:|---:|---:|---:|"])
            for row in summary_rows:
                lines.append(
                    f"| {row['field']} | {row.get('field_type', 'unknown')} | {row['n']} | {row['mean']:.4f} | {row['sd']:.4f} | {row['min']:.4f} | {row['max']:.4f} |"
                )
        lines.append("")
    if engine == "r" and r_markdown_document:
        lines.extend([
            "## R Markdown Output",
            "",
            "A platform-owned R Markdown template was generated and rendered into platform artifacts.",
            "",
        ])
    # Task-specific section
    task_family = _detect_task_family(study.slug, summary_rows)
    task_section = _render_task_section(task_family, summary_rows)
    if task_section:
        lines.append(task_section)
    return "\n".join(lines)


def _render_html_document(study, report_markdown):
    body = markdown_to_html(report_markdown, extensions=["tables", "fenced_code"])
    return "\n".join([
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"utf-8\" />",
        f"  <title>CogFlow Study Report: {study.name} ({study.slug})</title>",
        "  <style>",
        "    body { font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; margin: 2rem auto; max-width: 960px; color: #232742; line-height: 1.5; padding: 0 1rem; }",
        "    h1, h2, h3 { color: #30334A; }",
        "    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }",
        "    th, td { border: 1px solid #d0d6e2; padding: 0.45rem 0.55rem; text-align: left; }",
        "    th { background: #eef2f8; }",
        "    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }",
        "    pre { background: #f7f8fb; padding: 0.9rem; border-radius: 8px; overflow-x: auto; }",
        "  </style>",
        "</head>",
        "<body>",
        body,
        "</body>",
        "</html>",
    ])


def _render_pdf_document(study, report_html: str) -> bytes:
    """Render a PDF from the already-generated HTML artifact using WeasyPrint.
    Falls back to a plain reportlab PDF if WeasyPrint is unavailable."""
    try:
        from weasyprint import HTML  # noqa: PLC0415
        return HTML(string=report_html, base_url=None).write_pdf()
    except Exception as exc:  # noqa: BLE001
        logger.warning("WeasyPrint unavailable (%s); falling back to reportlab PDF.", exc)
        return _render_pdf_reportlab_fallback(study, report_html)


def _render_pdf_reportlab_fallback(study, report_html: str) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=48, bottomMargin=40)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"CogFlow Study Report: {study.name} ({study.slug})", styles["Title"]),
        Spacer(1, 12),
        Preformatted(re.sub(r"<[^>]+>", "", report_html)[:8000], styles["Code"]),
    ]
    doc.build(story)
    return buffer.getvalue()


def build_study_analysis_outputs(study, engine, options, include_completed_only=True):
    options = options or {}
    include_config_fields = bool(options.get("include_config_fields", False))
    fields_of_interest = [str(x).strip().lower() for x in (options.get("fields_of_interest") or []) if str(x).strip()]

    runs_qs = study.run_sessions.select_related("result_envelope", "config_version").prefetch_related("trial_results").order_by("-started_at")
    if include_completed_only:
        runs_qs = runs_qs.filter(status=RUN_STATUS_COMPLETED)

    run_count = runs_qs.count()
    with_result = 0
    trial_count = 0
    numeric_values_by_field = {}

    for run in runs_qs[:500]:
        envelope = getattr(run, "result_envelope", None)
        if not envelope:
            continue
        with_result += 1
        for trial in run.trial_results.all().order_by("trial_index"):
            payload = get_decrypted_trial(trial)
            flat = _flatten_numeric_fields(payload)
            if not flat:
                continue
            trial_count += 1
            for field, value in flat.items():
                numeric_values_by_field.setdefault(field, []).append(value)

    scored_fields = []
    for field in numeric_values_by_field.keys():
        if fields_of_interest and not _matches_interest(field, fields_of_interest):
            continue
        count = len(numeric_values_by_field.get(field, []))
        priority = _field_priority(field, fields_of_interest)
        field_type = "behavioral" if priority >= 0 else "config_like"
        if (not include_config_fields) and field_type != "behavioral":
            continue
        scored_fields.append((field, field_type, priority, count))

    scored_fields.sort(key=lambda item: (item[2], item[3], item[0]), reverse=True)
    max_variables = int(options.get("max_variables", 20) or 20)
    selected_fields = scored_fields[:max_variables]

    coverage_rows = [
        {"field": field, "field_type": field_type, "priority": priority, "count": count}
        for (field, field_type, priority, count) in selected_fields
    ]

    summary_rows = []
    for (field, field_type, _priority, _count) in selected_fields:
        desc = _describe_series(numeric_values_by_field.get(field, []))
        if desc["n"] == 0:
            continue
        summary_rows.append(
            {
                "field": field,
                "field_type": field_type,
                "n": desc["n"],
                "mean": desc["mean"],
                "sd": desc["sd"],
                "min": desc["min"],
                "max": desc["max"],
            }
        )

    overview = {
        "study_slug": study.slug,
        "study_name": study.name,
        "runs_considered": run_count,
        "runs_with_results": with_result,
        "trials_with_numeric_payload": trial_count,
        "numeric_variables_reported": len(summary_rows),
        "fields_of_interest": fields_of_interest,
        "include_config_fields": include_config_fields,
    }

    r_markdown_document = _render_r_markdown(study, overview, summary_rows) if engine == "r" else None
    report_markdown = _render_markdown_report(
        study=study,
        engine=engine,
        options=options,
        overview=overview,
        coverage_rows=coverage_rows,
        summary_rows=summary_rows,
        r_markdown_document=r_markdown_document,
    )
    report_html = _render_html_document(study, report_markdown)
    report_pdf_bytes = _render_pdf_document(study, report_html)
    return {
        "study_slug": study.slug,
        "engine": engine,
        "options": options,
        "overview": overview,
        "coverage": coverage_rows,
        "numeric_summary": summary_rows,
        "report_markdown": report_markdown,
        "r_markdown_document": r_markdown_document,
        "report_html": report_html,
        "report_pdf_bytes": report_pdf_bytes,
    }


def _upsert_text_artifact(job, artifact_format, file_name, mime_type, text_content, metadata=None):
    StudyAnalysisReportArtifact.objects.update_or_create(
        job=job,
        artifact_format=artifact_format,
        defaults={
            "file_name": file_name,
            "mime_type": mime_type,
            "text_content": text_content,
            "binary_content": None,
            "metadata_json": metadata or {},
        },
    )


def _upsert_binary_artifact(job, artifact_format, file_name, mime_type, binary_content, metadata=None):
    StudyAnalysisReportArtifact.objects.update_or_create(
        job=job,
        artifact_format=artifact_format,
        defaults={
            "file_name": file_name,
            "mime_type": mime_type,
            "text_content": "",
            "binary_content": binary_content,
            "metadata_json": metadata or {},
        },
    )


def process_report_job(job: StudyAnalysisReportJob):
    outputs = build_study_analysis_outputs(
        study=job.study,
        engine=job.engine,
        options=job.options,
        include_completed_only=job.include_completed_only,
    )
    formats = set(job.requested_formats or ["markdown", "html", "pdf", "snapshot"])
    if job.engine == "r":
        formats.add("rmd")

    snapshot_json = {
        "overview": outputs["overview"],
        "coverage": outputs["coverage"],
        "numeric_summary": outputs["numeric_summary"],
        "options": outputs["options"],
        "engine": outputs["engine"],
    }

    with transaction.atomic():
        job.snapshot_json = snapshot_json
        job.error_message = ""
        job.worker_log = "rendered report snapshot, markdown, html, and selected artifacts"
        job.status = StudyAnalysisReportJob.STATUS_SUCCEEDED
        job.completed_at = timezone.now()
        job.save(update_fields=["snapshot_json", "error_message", "worker_log", "status", "completed_at", "updated_at"])

        if "snapshot" in formats:
            _upsert_text_artifact(
                job,
                StudyAnalysisReportArtifact.FORMAT_SNAPSHOT,
                f"{job.study.slug}-report-job-{job.id}-snapshot.json",
                "application/json",
                json.dumps(snapshot_json, indent=2),
                {"kind": "analysis_snapshot"},
            )
        if "markdown" in formats:
            _upsert_text_artifact(
                job,
                StudyAnalysisReportArtifact.FORMAT_MARKDOWN,
                f"{job.study.slug}-report-job-{job.id}.md",
                "text/markdown",
                outputs["report_markdown"],
            )
        if "html" in formats:
            _upsert_text_artifact(
                job,
                StudyAnalysisReportArtifact.FORMAT_HTML,
                f"{job.study.slug}-report-job-{job.id}.html",
                "text/html",
                outputs["report_html"],
            )
        if "pdf" in formats:
            _upsert_binary_artifact(
                job,
                StudyAnalysisReportArtifact.FORMAT_PDF,
                f"{job.study.slug}-report-job-{job.id}.pdf",
                "application/pdf",
                outputs["report_pdf_bytes"],
                {"size_bytes": len(outputs["report_pdf_bytes"])},
            )
        if job.engine == "r" and outputs.get("r_markdown_document"):
            _upsert_text_artifact(
                job,
                StudyAnalysisReportArtifact.FORMAT_RMD,
                f"{job.study.slug}-report-job-{job.id}.Rmd",
                "text/x-r-markdown",
                outputs["r_markdown_document"],
            )

    return outputs


def mark_job_failed(job: StudyAnalysisReportJob, error_message: str):
    job.status = StudyAnalysisReportJob.STATUS_FAILED
    job.error_message = str(error_message or "Report job failed")
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "error_message", "completed_at", "updated_at"])


def claim_next_report_job():
    with transaction.atomic():
        job = (
            StudyAnalysisReportJob.objects.select_for_update(skip_locked=True)
            .filter(status=StudyAnalysisReportJob.STATUS_QUEUED)
            .select_related("study")
            .order_by("created_at")
            .first()
        )
        if not job:
            return None
        job.status = StudyAnalysisReportJob.STATUS_RUNNING
        job.started_at = timezone.now()
        job.error_message = ""
        job.save(update_fields=["status", "started_at", "error_message", "updated_at"])
        return job