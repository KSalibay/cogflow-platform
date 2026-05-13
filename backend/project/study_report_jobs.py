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


def _safe_get_decrypted_trial(trial):
    try:
        payload = get_decrypted_trial(trial)
        return payload if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning(
            "analysis: failed to decrypt trial payload",
            extra={"trial_result_id": getattr(trial, "id", None), "error": str(exc)},
        )
        return None


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
    path_segments = [seg for seg in field.split(".") if seg]
    for token in interests:
        if token == field:
            return True
        # Allow exact segment matches in dotted paths (e.g. data.rt_ms matches rt_ms).
        if token in path_segments:
            return True
        # For short generic tokens (rt, correct, accuracy), only match full segment
        # or segment-prefix, not anywhere inside a larger variable name.
        if any(seg == token or seg.startswith(f"{token}_") for seg in path_segments):
            return True
        # For structured tokens, allow nested matches by exact path prefix/suffix.
        if "." in token and (field.startswith(f"{token}.") or field.endswith(f".{token}")):
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
    "soc_dashboard": "SOC Dashboard",
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
    "soc_dashboard": {
        "rt": "Reaction Time (ms)",
        "response": "Response",
        "score": "Score",
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
    "soc_dashboard": (
        "**Interpretation guidance (SOC Dashboard):** "
        "Prioritize task-specific score and response distributions across dashboard components. "
        "Use per-item response patterns and timestamps to characterize strategy and consistency."
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


_TASK_FAMILY_DEFAULT_INTERESTS = {
    "rdm": [
        "rt", "rt_ms", "accuracy", "correct", "coherence", "correct_side",
        "response_side", "response_angle_deg", "response_angle_error_deg",
    ],
    "flanker": ["rt", "rt_ms", "accuracy", "correct", "congruent", "incongruent"],
    "sart": ["rt", "rt_ms", "commission_error", "omission_error", "correct"],
    "soc_dashboard": ["rt", "rt_ms", "response", "score", "correct", "choice", "confidence"],
    "nback": ["rt", "rt_ms", "accuracy", "correct", "match"],
    "gabor": ["rt", "rt_ms", "accuracy", "correct", "contrast", "threshold"],
    "wcst": ["rt", "rt_ms", "correct", "perseverative_error"],
    "stroop": ["rt", "rt_ms", "accuracy", "correct", "congruent", "incongruent"],
    "drt": ["drt_rt_ms", "drt_correct", "drt_responded", "rt", "rt_ms"],
    "generic": ["rt", "rt_ms", "accuracy", "correct", "response", "score"],
}

_TRIAL_CATEGORY_DEFAULT_INTERESTS = {
    "all": ["rt", "rt_ms", "accuracy", "correct", "response", "score"],
    "rdm": ["rt", "rt_ms", "accuracy", "correct", "coherence", "correct_side", "response_side", "response_angle_deg", "response_angle_error_deg"],
    "gabor": ["rt", "rt_ms", "accuracy", "correct", "contrast", "threshold", "orientation"],
    "drt": ["drt_rt_ms", "drt_correct", "drt_responded", "rt", "rt_ms"],
    "sart": ["rt", "rt_ms", "commission_error", "omission_error", "correct", "response"],
    "soc_dashboard": ["rt", "rt_ms", "response", "score", "choice", "confidence"],
    "mind_probe": ["rt", "rt_ms", "response", "responses", "q1", "q2"],
    "survey": ["rt", "rt_ms", "response", "responses", "q1", "q2"],
    "other": ["rt", "rt_ms", "accuracy", "correct", "response"],
}


def _categorize_trial_payload(payload: dict) -> str:
    if not isinstance(payload, dict):
        return "other"
    plugin = str(payload.get("plugin_type") or "").strip().lower()
    task = str(payload.get("task_type") or "").strip().lower()
    trial_type = str(payload.get("trial_type") or "").strip().lower()

    if plugin in {"rdm-trial", "rdm-continuous", "rdm"} or task in {"rdm", "rdk"} or trial_type in {"rdm", "rdm-continuous"}:
        return "rdm"
    if task in {"gabor", "gabor-patch", "gabor_patch"} or "gabor" in plugin or "gabor" in trial_type:
        return "gabor"
    if task in {"sart", "go-nogo", "go_nogo"} or "sart" in plugin or "sart" in trial_type:
        return "sart"
    if task in {"soc_dashboard", "soc-dashboard", "soc"} or "soc-dashboard" in plugin or "soc_dashboard" in plugin:
        return "soc_dashboard"
    if plugin == "drt" or task == "drt" or plugin in {"drt-start", "drt-stop"}:
        return "drt"
    if plugin == "survey-response":
        q1 = str(((payload.get("responses") or {}).get("q1") if isinstance(payload.get("responses"), dict) else "") or "").strip().lower()
        if any(tok in q1 for tok in ["on task", "mind", "off-task", "task-related interference"]):
            return "mind_probe"
        return "survey"
    return "other"


def _detect_task_family_from_metadata(study_slug: str, task_types: set[str], plugin_types: set[str], numeric_fields: set[str]) -> str:
    task_values = {str(x or "").strip().lower() for x in (task_types or set()) if str(x or "").strip()}
    plugin_values = {str(x or "").strip().lower() for x in (plugin_types or set()) if str(x or "").strip()}
    field_rows = [{"field": f} for f in sorted(numeric_fields or set())]

    if any(t in {"rdm", "rdk"} for t in task_values):
        return "rdm"
    if any(t in {"sart", "go-nogo", "go_nogo"} for t in task_values):
        return "sart"
    if any(t in {"soc_dashboard", "soc-dashboard", "soc"} for t in task_values):
        return "soc_dashboard"
    if any(t in {"flanker"} for t in task_values):
        return "flanker"
    if any(t in {"nback", "n-back", "n_back"} for t in task_values):
        return "nback"
    if any(t in {"gabor"} for t in task_values):
        return "gabor"
    if any(t in {"stroop"} for t in task_values):
        return "stroop"
    if any(t in {"wcst"} for t in task_values):
        return "wcst"
    if any("rdm" in p or "dot" in p for p in plugin_values):
        return "rdm"
    if any("gabor" in p for p in plugin_values):
        return "gabor"
    if any("soc-dashboard" in p or "soc_dashboard" in p for p in plugin_values):
        return "soc_dashboard"
    if "drt" in task_values or any(p == "drt" for p in plugin_values):
        return "drt"

    # Reuse existing slug/field heuristic as fallback.
    return _detect_task_family(study_slug, field_rows)


def infer_study_analysis_defaults(study, include_completed_only=True, max_runs=40, max_trials_per_run=2000):
    runs_qs = study.run_sessions.select_related("result_envelope").prefetch_related("trial_results").order_by("-started_at")
    if include_completed_only:
        runs_qs = runs_qs.filter(status=RUN_STATUS_COMPLETED)

    task_types = set()
    plugin_types = set()
    experiment_types = set()
    numeric_fields = set()
    category_counts = {}
    sampled_runs = 0
    sampled_trials = 0

    for run in runs_qs[:max_runs]:
        envelope = getattr(run, "result_envelope", None)
        if not envelope:
            continue
        sampled_runs += 1

        for trial in run.trial_results.all().order_by("trial_index")[:max_trials_per_run]:
            payload = _safe_get_decrypted_trial(trial)
            if payload is None:
                continue

            task_type = str(payload.get("task_type") or "").strip().lower()
            plugin_type = str(payload.get("plugin_type") or "").strip().lower()
            experiment_type = str(payload.get("experiment_type") or "").strip().lower()

            if task_type:
                task_types.add(task_type)
            if plugin_type:
                plugin_types.add(plugin_type)
            if experiment_type:
                experiment_types.add(experiment_type)

            flat_numeric = _flatten_numeric_fields(payload)
            if flat_numeric:
                numeric_fields.update(flat_numeric.keys())

            category = _categorize_trial_payload(payload)
            category_counts[category] = int(category_counts.get(category, 0)) + 1

            sampled_trials += 1

    # Fallback hints when payload decryption is unavailable or sparse.
    slug = str(study.slug or "").lower()
    if sampled_trials == 0:
        if "rdm" in slug or "rdk" in slug:
            category_counts["rdm"] = max(1, int(category_counts.get("rdm", 0)))
            task_types.add("rdm")
        if "drt" in slug:
            category_counts["drt"] = max(1, int(category_counts.get("drt", 0)))
            task_types.add("drt")
        if "mw" in slug or "mind" in slug:
            category_counts["mind_probe"] = max(1, int(category_counts.get("mind_probe", 0)))
            category_counts["survey"] = max(1, int(category_counts.get("survey", 0)))

    family = _detect_task_family_from_metadata(study.slug, task_types, plugin_types, numeric_fields)
    label = _TASK_FAMILY_LABELS.get(family) or "Generic"
    suggested = list(_TASK_FAMILY_DEFAULT_INTERESTS.get(family, _TASK_FAMILY_DEFAULT_INTERESTS["generic"]))

    # Continuous RDM often includes DRT side-channel telemetry in the same run.
    if family == "rdm" and ("drt" in task_types or "drt" in plugin_types):
        for extra in ["drt_rt_ms", "drt_correct", "drt_responded"]:
            if extra not in suggested:
                suggested.append(extra)

    observed_categories = [
        key for key, _count in sorted(category_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    if "all" not in observed_categories:
        observed_categories = ["all", *observed_categories]

    suggested_by_category = {}
    for category in observed_categories:
        base = list(_TRIAL_CATEGORY_DEFAULT_INTERESTS.get(category, _TRIAL_CATEGORY_DEFAULT_INTERESTS["other"]))
        # For "all", prefer family defaults first.
        if category == "all":
            merged = []
            for token in [*suggested, *base]:
                t = str(token or "").strip().lower()
                if t and t not in merged:
                    merged.append(t)
            suggested_by_category[category] = merged
        else:
            suggested_by_category[category] = [str(x).strip().lower() for x in base if str(x).strip()]

    return {
        "task_family": family,
        "task_family_label": label,
        "suggested_fields_of_interest": suggested,
        "suggested_fields_by_category": suggested_by_category,
        "observed_trial_categories": observed_categories,
        "observed_trial_category_counts": {k: int(v) for k, v in category_counts.items()},
        "observed_task_types": sorted(task_types),
        "observed_plugin_types": sorted(plugin_types),
        "observed_experiment_types": sorted(experiment_types),
        "sampled_runs": sampled_runs,
        "sampled_trials": sampled_trials,
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


def _render_markdown_report(
    study,
    engine,
    options,
    overview,
    coverage_rows,
    summary_rows,
    participant_summary_rows=None,
    r_markdown_document=None,
):
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
    if options.get("include_participant_summary", False):
        lines.extend(["## Participant-Level Numeric Summary", ""])
        if not participant_summary_rows:
            lines.append("No participant-level numeric variables were available for descriptive statistics.")
        else:
            lines.extend([
                "| Participant | Variable | Type | N | Mean | SD | Min | Max |",
                "|---|---|---|---:|---:|---:|---:|---:|",
            ])
            for row in participant_summary_rows:
                lines.append(
                    f"| {row['participant_id']} | {row['field']} | {row.get('field_type', 'unknown')} | {row['n']}"
                    f" | {row['mean']:.4f} | {row['sd']:.4f} | {row['min']:.4f} | {row['max']:.4f} |"
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
    include_participant_summary = bool(options.get("include_participant_summary", False))
    max_participants = int(options.get("max_participants", 25) or 25)
    max_participants = max(1, min(200, max_participants))
    fields_of_interest = [str(x).strip().lower() for x in (options.get("fields_of_interest") or []) if str(x).strip()]
    selected_categories = [str(x).strip().lower() for x in (options.get("trial_categories") or []) if str(x).strip()]
    if not selected_categories or "all" in selected_categories:
        selected_categories = ["all"]

    runs_qs = study.run_sessions.select_related("result_envelope", "config_version").prefetch_related("trial_results").order_by("-started_at")
    if include_completed_only:
        runs_qs = runs_qs.filter(status=RUN_STATUS_COMPLETED)

    run_count = runs_qs.count()
    with_result = 0
    trial_count = 0
    numeric_values_by_field = {}
    participant_values_by_field = {}
    participant_numeric_trial_counts = {}
    participant_label_by_key = {}

    def get_participant_label(run_obj):
        participant_key = str(getattr(run_obj, "participant_key", "") or "").strip()
        if not participant_key:
            participant_key = f"run-{getattr(run_obj, 'id', 'unknown')}"
        if participant_key not in participant_label_by_key:
            participant_label_by_key[participant_key] = f"P{len(participant_label_by_key) + 1:03d}"
        return participant_label_by_key[participant_key]

    for run in runs_qs[:500]:
        envelope = getattr(run, "result_envelope", None)
        if not envelope:
            continue
        with_result += 1
        participant_label = get_participant_label(run)
        for trial in run.trial_results.all().order_by("trial_index"):
            payload = _safe_get_decrypted_trial(trial)
            if payload is None:
                continue
            category = _categorize_trial_payload(payload if isinstance(payload, dict) else {})
            if selected_categories != ["all"] and category not in selected_categories:
                continue
            flat = _flatten_numeric_fields(payload)
            if not flat:
                continue
            trial_count += 1
            participant_numeric_trial_counts[participant_label] = int(participant_numeric_trial_counts.get(participant_label, 0)) + 1
            for field, value in flat.items():
                numeric_values_by_field.setdefault(field, []).append(value)
                participant_values_by_field.setdefault(participant_label, {}).setdefault(field, []).append(value)

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

    participant_summary_rows = []
    if include_participant_summary:
        participant_order = [
            pid
            for pid, _n_trials in sorted(
                participant_numeric_trial_counts.items(),
                key=lambda kv: (-int(kv[1]), str(kv[0])),
            )[:max_participants]
        ]
        for participant_id in participant_order:
            per_participant_fields = participant_values_by_field.get(participant_id, {})
            for (field, field_type, _priority, _count) in selected_fields:
                desc = _describe_series(per_participant_fields.get(field, []))
                if desc["n"] == 0:
                    continue
                participant_summary_rows.append(
                    {
                        "participant_id": participant_id,
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
        "participant_count_with_numeric_payload": len(participant_numeric_trial_counts),
        "participant_rows_reported": len(participant_summary_rows),
        "fields_of_interest": fields_of_interest,
        "include_config_fields": include_config_fields,
        "include_participant_summary": include_participant_summary,
        "max_participants": max_participants,
        "trial_categories": selected_categories,
    }

    r_markdown_document = _render_r_markdown(study, overview, summary_rows) if engine == "r" else None
    report_markdown = _render_markdown_report(
        study=study,
        engine=engine,
        options=options,
        overview=overview,
        coverage_rows=coverage_rows,
        summary_rows=summary_rows,
        participant_summary_rows=participant_summary_rows,
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
        "participant_numeric_summary": participant_summary_rows,
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
    # Defense in depth: strip per-participant summary if the permissions snapshot
    # stored at job creation time does not include can_view_run_rows.  This protects
    # against permission changes between job queuing and job execution.
    stored_perms = job.permissions_snapshot or {}
    job_options = dict(job.options or {})
    if job_options.get("include_participant_summary") and not stored_perms.get("can_view_run_rows"):
        job_options["include_participant_summary"] = False
        logger.warning(
            "process_report_job: stripped include_participant_summary due to missing can_view_run_rows",
            extra={"job_id": job.id, "study_slug": job.study.slug},
        )

    outputs = build_study_analysis_outputs(
        study=job.study,
        engine=job.engine,
        options=job_options,
        include_completed_only=job.include_completed_only,
    )
    formats = set(job.requested_formats or ["markdown", "html", "pdf", "snapshot"])
    if job.engine == "r":
        formats.add("rmd")

    snapshot_json = {
        "overview": outputs["overview"],
        "coverage": outputs["coverage"],
        "numeric_summary": outputs["numeric_summary"],
        "participant_numeric_summary": outputs.get("participant_numeric_summary") or [],
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