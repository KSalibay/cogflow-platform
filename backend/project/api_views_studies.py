from django.http import HttpResponse
from django.utils import timezone
from django.db.models.deletion import ProtectedError
from copy import deepcopy
from datetime import datetime
import io
import zipfile

from .api_views_common import *
from .study_report_jobs import build_study_analysis_outputs, infer_study_analysis_defaults


def _require_study_analysis_access(request, study_slug: str):
    if not request.user.is_authenticated:
        return None, None, None, Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    profile = get_or_create_profile(request.user)
    if not _can_access_analysis_resources(request, profile):
        return None, None, None, Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

    study = Study.objects.filter(slug=study_slug, is_active=True).first()
    if not study:
        return None, None, None, Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _has_study_access(study, request.user, profile):
        return None, None, None, Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

    perms = _study_access_permissions(study, request.user, profile)
    if not perms.get("can_run_analysis"):
        return None, None, None, Response({"error": "Analysis access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)
    if not perms.get("can_download_aggregate"):
        return None, None, None, Response({"error": "Aggregate analysis access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)

    return study, profile, perms, None


def _serialize_report_job(job: StudyAnalysisReportJob):
    artifacts = []
    for artifact in job.artifacts.all().order_by("created_at"):
        text_size = len((artifact.text_content or "").encode("utf-8")) if artifact.text_content else 0
        binary_size = len(artifact.binary_content or b"") if artifact.binary_content else 0
        artifacts.append(
            {
                "format": artifact.artifact_format,
                "file_name": artifact.file_name,
                "mime_type": artifact.mime_type,
                "size_bytes": binary_size or text_size,
                "download_url": f"/api/v1/studies/analysis/jobs/{job.id}/artifacts/{artifact.artifact_format}",
                "created_at": artifact.created_at,
            }
        )
    return {
        "id": job.id,
        "study_slug": job.study.slug,
        "study_name": job.study.name,
        "status": job.status,
        "engine": job.engine,
        "requested_formats": job.requested_formats,
        "include_completed_only": job.include_completed_only,
        "options": job.options,
        "permissions_snapshot": job.permissions_snapshot,
        "overview": (job.snapshot_json or {}).get("overview", {}),
        "numeric_summary": (job.snapshot_json or {}).get("numeric_summary", []),
        "variant_numeric_summary": (job.snapshot_json or {}).get("variant_numeric_summary", []),
        "error_message": job.error_message,
        "worker_log": job.worker_log,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "artifacts": artifacts,
    }


def _safe_bundle_name(text: str, fallback: str = "item") -> str:
    raw = (text or "").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    return cleaned or fallback


def _rewrite_builder_asset_urls_for_bundle(value, collected_paths: set[str]):
    """Rewrite platform asset URLs to local /study_assets paths and collect storage keys."""
    if isinstance(value, dict):
        return {k: _rewrite_builder_asset_urls_for_bundle(v, collected_paths) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite_builder_asset_urls_for_bundle(v, collected_paths) for v in value]
    if not isinstance(value, str):
        return value

    out = value

    def _replace_match(m):
        path = (m.group("path") or "").strip().replace("\\", "/")
        path = path.split("?", 1)[0].split("#", 1)[0]
        if not path.startswith("builder-assets/"):
            return m.group(0)
        collected_paths.add(path)
        rel = path[len("builder-assets/"):].lstrip("/")
        return f"/study_assets/{rel}"

    patterns = [
        r"https?://[^\s\"']+/(?:api/v1/assets/file|media)/(?P<path>builder-assets/[A-Za-z0-9._\-/]+)(?:\?[^\s\"']*)?",
        r"/(?:api/v1/assets/file|media)/(?P<path>builder-assets/[A-Za-z0-9._\-/]+)(?:\?[^\s\"']*)?",
        r"(?P<path>builder-assets/[A-Za-z0-9._\-/]+)(?:\?[^\s\"']*)?",
    ]
    for pat in patterns:
        out = re.sub(pat, _replace_match, out)
    return out


_BUNDLE_CORE_RUNTIME_FILES = {
    "src/configLoader.js",
    "src/djangoRuntimeBackend.js",
    "src/main.js",
    "src/timelineCompiler.js",
}

_BUNDLE_OPTIONAL_RUNTIME_FILES = {
    "src/drtEngine.js",
}

_BUNDLE_MARKER_TO_FILES = {
    "continuous-image-presentation": {"src/jspsych-continuous-image-presentation.js"},
    "flanker": {"src/jspsych-flanker.js"},
    "gabor": {"src/jspsych-gabor.js"},
    "gabor-learning": {"src/jspsych-gabor.js"},
    "gabor-quest": {"src/jspsych-gabor.js"},
    "gabor-trial": {"src/jspsych-gabor.js"},
    "mot": {"src/jspsych-mot.js"},
    "mot-trial": {"src/jspsych-mot.js"},
    "nback": {"src/jspsych-nback.js", "src/jspsych-nback-continuous.js"},
    "nback-continuous": {"src/jspsych-nback-continuous.js", "src/jspsych-nback.js"},
    "nback-trial": {"src/jspsych-nback.js", "src/jspsych-nback-continuous.js"},
    "pvt": {"src/jspsych-pvt.js"},
    "pvt-trial": {"src/jspsych-pvt.js"},
    "rdm": {"src/rdmEngine.js", "src/jspsych-rdm.js", "src/jspsych-rdm-continuous.js"},
    "rdm-continuous": {"src/rdmEngine.js", "src/jspsych-rdm.js", "src/jspsych-rdm-continuous.js"},
    "sart": {"src/jspsych-sart.js"},
    "sart-trial": {"src/jspsych-sart.js"},
    "simon": {"src/jspsych-simon.js"},
    "simon-trial": {"src/jspsych-simon.js"},
    "soc": {
        "src/jspsych-continuous-image-presentation.js",
        "src/jspsych-gabor.js",
        "src/jspsych-rdm.js",
        "src/jspsych-soc-dashboard.js",
    },
    "soc-dashboard": {
        "src/jspsych-continuous-image-presentation.js",
        "src/jspsych-gabor.js",
        "src/jspsych-rdm.js",
        "src/jspsych-soc-dashboard.js",
    },
    "soc-dashboard-icon": {"src/jspsych-soc-dashboard.js"},
    "soc-subtask-cpt": {"src/jspsych-continuous-image-presentation.js", "src/jspsych-soc-dashboard.js"},
    "soc-subtask-gabor": {"src/jspsych-gabor.js", "src/jspsych-soc-dashboard.js"},
    "soc-subtask-rdm": {"src/jspsych-rdm.js", "src/jspsych-soc-dashboard.js", "src/rdmEngine.js"},
    "stroop": {"src/jspsych-stroop.js"},
    "stroop-trial": {"src/jspsych-stroop.js"},
    "survey": {"src/jspsych-survey-response.js"},
    "survey-response": {"src/jspsych-survey-response.js"},
    "task-switching": {"src/jspsych-task-switching.js"},
    "task-switching-trial": {"src/jspsych-task-switching.js"},
    "visual-angle-calibration": {"src/jspsych-visual-angle-calibration.js"},
}


def _iter_config_markers(value, markers: set[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_norm = str(key or "").strip().lower()
            if key_norm in {"task_type", "block_component_type", "type", "plugin_type"} and isinstance(child, str):
                marker = child.strip().lower()
                if marker:
                    markers.add(marker)
            _iter_config_markers(child, markers)
        return
    if isinstance(value, list):
        for child in value:
            _iter_config_markers(child, markers)


def _config_uses_eye_tracking(config_obj) -> bool:
    if isinstance(config_obj, dict):
        dc = config_obj.get("data_collection")
        if isinstance(dc, dict):
            eye = dc.get("eye_tracking")
            if eye is True:
                return True
            if isinstance(eye, dict) and eye.get("enabled") not in {None, False, 0, "0", "false", "False"}:
                return True
        eye = config_obj.get("eye_tracking")
        if eye is True:
            return True
        if isinstance(eye, dict) and eye.get("enabled") not in {None, False, 0, "0", "false", "False"}:
            return True
        for child in config_obj.values():
            if _config_uses_eye_tracking(child):
                return True
        return False
    if isinstance(config_obj, list):
        return any(_config_uses_eye_tracking(child) for child in config_obj)
    return False


def _collect_required_runtime_files(config_payloads: list[dict], interpreter_dir) -> set[str]:
    selected = set(_BUNDLE_CORE_RUNTIME_FILES)
    selected.update(_BUNDLE_OPTIONAL_RUNTIME_FILES)
    markers: set[str] = set()
    uses_eye_tracking = False

    for cfg in config_payloads:
        _iter_config_markers(cfg, markers)
        uses_eye_tracking = uses_eye_tracking or _config_uses_eye_tracking(cfg)

    matched_any = False
    for marker in markers:
        files = _BUNDLE_MARKER_TO_FILES.get(marker)
        if not files:
            continue
        matched_any = True
        selected.update(files)

    if uses_eye_tracking:
        selected.add("src/eyeTrackingWebgazer.js")
        selected.add("src/jspsych-visual-angle-calibration.js")

    if not matched_any:
        for p in (interpreter_dir / "src").glob("*.js"):
            selected.add(f"src/{p.name}")

    if uses_eye_tracking:
        selected.add("vendor/webgazer.min.js")
        for vendor_name in ("THIRD_PARTY_NOTICES.md", "WEBGAZER_LICENSE.md"):
            vendor_path = interpreter_dir / "vendor" / vendor_name
            if vendor_path.exists():
                selected.add(f"vendor/{vendor_name}")

    selected.add("index.html")
    return selected


def _build_kiosk_index_html(interpreter_dir, runtime_files: set[str]) -> str:
    source = (interpreter_dir / "index.html").read_text(encoding="utf-8")
    filtered_lines = []
    for line in source.splitlines():
        match = re.search(r'<script\s+src="(?P<src>src/[^"]+)"', line)
        if match:
            src_path = match.group("src").split("?", 1)[0]
            if src_path not in runtime_files:
                continue
        filtered_lines.append(line)

    html = "\n".join(filtered_lines)
    kiosk_snippet = (
        "  <script>\n"
        "    window.COGFLOW_KIOSK_MODE = true;\n"
        "  </script>\n"
    )
    html = html.replace("</body>", f"{kiosk_snippet}</body>")
    return html


def _write_zip_text(zf: zipfile.ZipFile, arcname: str, content: str, executable: bool = False) -> None:
    info = zipfile.ZipInfo(arcname)
    info.compress_type = zipfile.ZIP_DEFLATED
    if executable:
        info.external_attr = 0o755 << 16
    else:
        info.external_attr = 0o644 << 16
    zf.writestr(info, content)


_TAKE_TO_GO_SYSTEM_ALIASES = {
    "generic": "generic",
    "default": "generic",
    "lsl": "generic",
    "biosemi": "biosemi",
    "brainproducts": "brainproducts",
    "brain-products": "brainproducts",
    "brain_products": "brainproducts",
    "brainvision": "brainproducts",
}


def _normalize_take_to_go_system(value) -> str:
    raw = str(value or "generic").strip().lower()
    return _TAKE_TO_GO_SYSTEM_ALIASES.get(raw, "")


def _normalize_take_to_go_metadata_payload(value) -> dict:
    if value in (None, "", {}):
        return {}
    if not isinstance(value, dict):
        raise ValueError("interpreter_metadata must be a JSON object")

    try:
        raw = json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"interpreter_metadata is not JSON-serializable: {exc}")

    if len(raw.encode("utf-8")) > 262_144:
        raise ValueError("interpreter_metadata is too large (max 256KB)")

    # Re-load to ensure we only carry JSON-native values.
    return json.loads(raw)


def _build_take_to_go_metadata_files(
    study: Study,
    config_versions: list[ConfigVersion],
    include_all_versions: bool,
    bundle_system: str,
    request_metadata: dict | None = None,
) -> dict[str, dict]:
    normalized_props = _normalize_study_launch_properties(study, config_versions)
    safe_request_metadata = request_metadata if isinstance(request_metadata, dict) else {}
    engine_options = safe_request_metadata.get("engine_options")
    if not isinstance(engine_options, dict):
        engine_options = {}

    variant_selection = safe_request_metadata.get("variant_selection")
    if not isinstance(variant_selection, dict):
        variant_selection = {}

    selected_variant_id = str(variant_selection.get("variant_id") or "").strip()
    selected_variant = None
    if selected_variant_id:
        selected_variant = next(
            (
                variant
                for variant in (normalized_props.get("flow_variants") or [])
                if str(variant.get("id") or "").strip() == selected_variant_id
            ),
            None,
        )

    files = {
        "bundle_profile.json": {
            "study_slug": study.slug,
            "bundle_system": bundle_system,
            "include_all_versions": bool(include_all_versions),
            "config_count": len(config_versions),
            "generated_at": timezone.now().isoformat(),
        },
        "study_properties_snapshot.json": normalized_props,
        "engine_task_flow.json": {
            "study_slug": study.slug,
            "bundle_system": bundle_system,
            "variant_mode": str(engine_options.get("variant_mode") or "auto").strip() or "auto",
            "use_saved_flow_variants": bool(engine_options.get("use_saved_flow_variants", False)),
            "selected_variant_id": selected_variant_id or None,
            "session_tag": str(engine_options.get("session_tag") or "").strip() or None,
            "notes": str(engine_options.get("notes") or "").strip() or None,
            "flow_variant_count": len(normalized_props.get("flow_variants") or []),
            "task_count": len((normalized_props.get("task_profile") or {}).get("items") or []),
        },
    }

    if safe_request_metadata:
        files["request_payload.json"] = safe_request_metadata
    if selected_variant:
        files["selected_variant.json"] = selected_variant
    return files


def _build_take_to_go_bundle_zip(
    study: Study,
    config_versions: list[ConfigVersion],
    bundle_system: str = "generic",
    metadata_files: dict[str, dict] | None = None,
) -> tuple[bytes, str, dict]:
    """Build a downloadable zip for local Interpreter + LSL bridge execution."""
    from django.conf import settings

    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    bundle_system = _normalize_take_to_go_system(bundle_system) or "generic"
    slug_safe = _safe_bundle_name(study.slug, "study")
    root_dir = f"cogflow-take-to-go-{slug_safe}-{ts}"
    filename = f"{root_dir}.zip"

    interpreter_dir = settings.BASE_DIR / "frontend" / "interpreter"
    if not interpreter_dir.exists():
        interpreter_dir = settings.BASE_DIR.parent / "frontend" / "interpreter"

    if not interpreter_dir.exists():
        raise FileNotFoundError("Interpreter frontend directory not found")

    all_asset_paths = set()
    config_manifest = []
    rewritten_configs: list[dict] = []

    bundle_bytes = io.BytesIO()
    metadata_files = metadata_files or {}

    with zipfile.ZipFile(bundle_bytes, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Add per-config JSON files with local asset URL rewrites.
        for idx, cv in enumerate(config_versions):
            cfg_obj = cv.config_json if isinstance(cv.config_json, dict) else {}
            cfg_copy = deepcopy(cfg_obj)
            cfg_copy = _rewrite_builder_asset_urls_for_bundle(cfg_copy, all_asset_paths)
            rewritten_configs.append(cfg_copy)

            id_raw = cv.version_label or f"config-{idx + 1}"
            config_id = _safe_bundle_name(id_raw, f"config-{idx + 1}")
            cfg_name = f"{config_id}.json"
            cfg_json = json.dumps(cfg_copy, indent=2)
            zf.writestr(f"{root_dir}/interpreter/configs/{cfg_name}", cfg_json)
            config_manifest.append(cfg_name)

        runtime_files = _collect_required_runtime_files(rewritten_configs, interpreter_dir)
        filtered_index = _build_kiosk_index_html(interpreter_dir, runtime_files)
        _write_zip_text(zf, f"{root_dir}/interpreter/index.html", filtered_index)

        for rel in sorted(runtime_files):
            if rel == "index.html":
                continue
            source_path = interpreter_dir / rel
            if not source_path.exists() or not source_path.is_file():
                continue
            zf.write(source_path, arcname=f"{root_dir}/interpreter/{rel}")

        zf.writestr(
            f"{root_dir}/interpreter/configs/manifest.json",
            json.dumps(config_manifest, indent=2),
        )

        metadata_written = 0
        for metadata_name, payload in sorted(metadata_files.items()):
            safe_name = _safe_bundle_name(str(metadata_name), "metadata")
            if not safe_name.endswith(".json"):
                safe_name = f"{safe_name}.json"
            zf.writestr(
                f"{root_dir}/interpreter/metadata/{safe_name}",
                json.dumps(payload, indent=2),
            )
            metadata_written += 1

        # Copy referenced builder assets into local serving path.
        copied_assets = 0
        for asset_path in sorted(all_asset_paths):
            normalized = asset_path.replace("\\", "/").strip("/")
            if not normalized.startswith("builder-assets/"):
                continue
            if not default_storage.exists(normalized):
                continue

            rel = normalized[len("builder-assets/"):].lstrip("/")
            target = f"{root_dir}/interpreter/study_assets/{rel}"
            try:
                with default_storage.open(normalized, mode="rb") as fh:
                    zf.writestr(target, fh.read())
                copied_assets += 1
            except Exception:
                # Skip unreadable asset and continue bundle generation.
                continue

        latest_cfg = config_manifest[0] if config_manifest else ""
        latest_id = latest_cfg[:-5] if latest_cfg.endswith(".json") else latest_cfg

        launch_url = (
            f"http://127.0.0.1:8088/index.html?id={latest_id}&lsl=1&lsl_bridge=http://127.0.0.1:8765"
            if latest_id else
            "http://127.0.0.1:8088/index.html?lsl=1&lsl_bridge=http://127.0.0.1:8765"
        )

        readme = "# CogFlow Take-To-Go Bundle\n\n"
        readme += "This package runs your CogFlow study locally with a PyLSL bridge for marker streaming.\n\n"
        readme += "## Included\n"
        readme += "- Study-specific interpreter runtime and study configs/assets\n"
        readme += "- Interpreter metadata files for task-flow/variant engine options (`interpreter/metadata/*.json`)\n"
        readme += "- Local LSL bridge (FastAPI + pylsl)\n"
        readme += "- Docker Compose setup\n"
        readme += "- One-click kiosk launch scripts\n\n"
        readme += f"## Target System Profile\n- `{bundle_system}`\n\n"
        readme += "## Quick Start\n"
        readme += "1. Install Docker Desktop / Docker Engine + Compose plugin.\n"
        readme += "2. Double-click one of these files from the bundle root:\n"
        readme += "   - `run-kiosk.sh` on Linux\n"
        readme += "   - `Run Kiosk.command` on macOS\n"
        readme += "   - `run-kiosk.bat` on Windows\n"
        readme += f"3. The launcher waits for Docker services and opens: {launch_url}\n"
        readme += "\n"
        readme += "## Manual Fallback\n"
        readme += "- `docker compose up --build -d`\n"
        readme += f"- Open {launch_url}\n\n"
        readme += "## LSL Bridge\n"
        readme += "- Health: http://localhost:8765/healthz\n"
        readme += "- Marker endpoint: POST http://localhost:8765/v1/markers\n"
        readme += "- Behavioral result endpoint: POST http://localhost:8765/v1/results\n"
        readme += "- Persisted result files: `local_results/` in the bundle root\n"
        readme += "\n"
        readme += "## Notes\n"
        readme += "- Default stream type/name can be changed via docker-compose environment values.\n"
        readme += "- This bundle includes a system profile file at `lsl-bridge/system_profile.json`.\n"
        readme += "- For hardware-specific integrations (e.g., BrainVision/BioSemi TTL), extend `lsl-bridge/app.py` adapter hooks.\n"
        zf.writestr(f"{root_dir}/README.md", readme)

        system_guidance = {
            "generic": (
                "Generic LSL mode: publish event markers to LSL only.\n"
                "Use this when your acquisition stack consumes LSL markers directly."
            ),
            "biosemi": (
                "BioSemi prep mode: keep LSL markers enabled and plan TTL trigger-line wiring for production recordings.\n"
                "BioSemi timing-critical workflows are typically validated via hardware trigger/status channels."
            ),
            "brainproducts": (
                "Brain Products prep mode: keep LSL markers enabled and align connector setup with BrainVision LSL tooling\n"
                "(e.g., BrainVision RDA/LiveAmp/BrainAmp connector family) depending on your amplifier."
            ),
        }
        zf.writestr(
            f"{root_dir}/lsl-bridge/system_profile.json",
            json.dumps(
                {
                    "target_system": bundle_system,
                    "target_system_label": {
                        "generic": "Generic LSL",
                        "biosemi": "BioSemi",
                        "brainproducts": "Brain Products",
                    }.get(bundle_system, "Generic LSL"),
                    "notes": system_guidance.get(bundle_system, system_guidance["generic"]),
                },
                indent=2,
            ),
        )

        compose_yml = """services:
  interpreter:
    build:
      context: ./interpreter
    container_name: cogflow-interpreter-local
    ports:
      - "8088:8080"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/index.html')"]
      interval: 5s
      timeout: 4s
      retries: 30
    restart: unless-stopped

  lsl-bridge:
    build:
      context: ./lsl-bridge
    container_name: cogflow-lsl-bridge
    ports:
      - "8765:8765"
    environment:
      - LSL_STREAM_NAME=CogFlowMarkers
      - LSL_STREAM_TYPE=Markers
      - LSL_SOURCE_ID=cogflow-local
            - COGFLOW_TARGET_SYSTEM={bundle_system}
            - COGFLOW_RESULTS_DIR=/data/results
        volumes:
            - ./local_results:/data/results
        healthcheck:
            test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz')"]
            interval: 5s
            timeout: 4s
            retries: 30
    restart: unless-stopped
"""
        zf.writestr(f"{root_dir}/docker-compose.yml", compose_yml)

        interpreter_dockerfile = """FROM python:3.12-slim
WORKDIR /app
COPY . /app
EXPOSE 8080
CMD ["python", "-m", "http.server", "8080", "--directory", "/app"]
"""
        zf.writestr(f"{root_dir}/interpreter/Dockerfile", interpreter_dockerfile)

        lsl_requirements = """fastapi==0.115.2
uvicorn[standard]==0.30.6
pylsl==1.16.2
pydantic==2.9.2
"""
        zf.writestr(f"{root_dir}/lsl-bridge/requirements.txt", lsl_requirements)

        lsl_dockerfile = """FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app.py /app/app.py
EXPOSE 8765
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
"""
        zf.writestr(f"{root_dir}/lsl-bridge/Dockerfile", lsl_dockerfile)

        lsl_app = """import json
import os
    import re
    from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI
from pydantic import BaseModel, Field

try:
    from pylsl import StreamInfo, StreamOutlet, local_clock
except Exception as exc:
    StreamInfo = None
    StreamOutlet = None
    local_clock = None
    _IMPORT_ERROR = str(exc)
else:
    _IMPORT_ERROR = ""


class MarkerPayload(BaseModel):
    event_type: str = Field(default="event")
    event_code: int | None = None
    timestamp_ms: float | None = None
    study_slug: str | None = None
    config_id: str | None = None
    run_session_id: str | None = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class LocalResultPayload(BaseModel):
    source: str = Field(default="interpreter-local")
    payload: Dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="CogFlow LSL Bridge", version="0.1.0")

_stream_name = os.getenv("LSL_STREAM_NAME", "CogFlowMarkers")
_stream_type = os.getenv("LSL_STREAM_TYPE", "Markers")
_source_id = os.getenv("LSL_SOURCE_ID", "cogflow-local")
_target_system = os.getenv("COGFLOW_TARGET_SYSTEM", "generic").strip().lower() or "generic"
_results_dir = os.getenv("COGFLOW_RESULTS_DIR", "/data/results")

try:
    os.makedirs(_results_dir, exist_ok=True)
except Exception:
    pass

_outlet = None
if StreamInfo is not None and StreamOutlet is not None:
    info = StreamInfo(_stream_name, _stream_type, 1, 0, "string", _source_id)
    _outlet = StreamOutlet(info)


@app.get("/healthz")
def healthz():
    return {
        "ok": _outlet is not None,
        "stream_name": _stream_name,
        "stream_type": _stream_type,
        "source_id": _source_id,
        "target_system": _target_system,
        "results_dir": _results_dir,
        "pylsl_import_error": _IMPORT_ERROR or None,
    }


@app.post("/v1/markers")
def emit_marker(marker: MarkerPayload):
    sample = json.dumps(marker.model_dump(), separators=(",", ":"))
    pushed = False
    if _outlet is not None:
        try:
            if marker.timestamp_ms is not None and local_clock is not None:
                ts = float(marker.timestamp_ms) / 1000.0
                _outlet.push_sample([sample], timestamp=ts)
            else:
                _outlet.push_sample([sample])
            pushed = True
        except Exception:
            pushed = False

    # Adapter hook for future hardware-specific trigger fan-out.
    # Current implementation keeps the same LSL marker behavior for all profiles.
    return {"ok": True, "pushed": pushed, "stream_name": _stream_name, "target_system": _target_system}


def _safe_file_token(value: str, fallback: str = "run") -> str:
    token = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-._")
    return token or fallback


@app.post("/v1/results")
def persist_result(result: LocalResultPayload):
    payload = result.payload if isinstance(result.payload, dict) else {}
    slug_token = _safe_file_token(
        payload.get("study_slug")
        or payload.get("config_id")
        or payload.get("export_code")
        or "run",
        "run",
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    file_name = f"cogflow-result-{slug_token}-{stamp}.json"
    file_path = os.path.join(_results_dir, file_name)

    doc = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "source": result.source,
        "target_system": _target_system,
        "payload": payload,
    }

    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
        size_bytes = os.path.getsize(file_path)
        return {
            "ok": True,
            "file_name": file_name,
            "path": file_path,
            "size_bytes": size_bytes,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "results_dir": _results_dir,
        }
"""
        zf.writestr(f"{root_dir}/lsl-bridge/app.py", lsl_app)

        wait_script = f"""#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIOSK_URL="{launch_url}"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required but was not found in PATH."
    exit 1
fi

cd "$ROOT_DIR"
docker compose up --build -d

for attempt in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:8088/index.html" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:8765/healthz" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

if command -v google-chrome >/dev/null 2>&1; then
    nohup google-chrome --kiosk "$KIOSK_URL" >/dev/null 2>&1 &
elif command -v chromium-browser >/dev/null 2>&1; then
    nohup chromium-browser --kiosk "$KIOSK_URL" >/dev/null 2>&1 &
elif command -v chromium >/dev/null 2>&1; then
    nohup chromium --kiosk "$KIOSK_URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$KIOSK_URL" >/dev/null 2>&1 &
else
    echo "Open this URL manually: $KIOSK_URL"
fi

echo "Kiosk launch attempted."
"""
        _write_zip_text(zf, f"{root_dir}/run-kiosk.sh", wait_script, executable=True)
        _write_zip_text(zf, f"{root_dir}/Run Kiosk.command", wait_script, executable=True)

        windows_launcher = f"""@echo off
setlocal
set ROOT_DIR=%~dp0
set KIOSK_URL={launch_url}

docker compose -f "%ROOT_DIR%docker-compose.yml" up --build -d
if errorlevel 1 exit /b 1

echo Waiting for services...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; for ($i=0; $i -lt 90; $i++) {{ try {{ Invoke-WebRequest 'http://127.0.0.1:8088/index.html' -UseBasicParsing | Out-Null; Invoke-WebRequest 'http://127.0.0.1:8765/healthz' -UseBasicParsing | Out-Null; exit 0 }} catch {{ Start-Sleep -Seconds 2 }} }}; exit 1"

start "" msedge --kiosk "%KIOSK_URL%"
if errorlevel 1 start "" chrome --kiosk "%KIOSK_URL%"
if errorlevel 1 start "" "%KIOSK_URL%"
"""
        _write_zip_text(zf, f"{root_dir}/run-kiosk.bat", windows_launcher)

        stop_script = """#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
docker compose down
"""
        _write_zip_text(zf, f"{root_dir}/stop-kiosk.sh", stop_script, executable=True)

    meta = {
        "config_count": len(config_manifest),
        "asset_count": len(all_asset_paths),
        "asset_copied_count": copied_assets,
        "runtime_file_count": len(runtime_files),
        "metadata_file_count": metadata_written,
        "bundle_system": bundle_system,
    }
    return bundle_bytes.getvalue(), filename, meta


class StudiesListView(APIView):
    def get(self, request):
        if not request.user.is_authenticated:
            _record_auth_rejection(request, endpoint="studies/list", reason="unauthenticated")
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_access_analysis_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        studies_qs = Study.objects.filter(is_active=True)
        # Keep legacy, unowned studies visible while enforcing owner/share RBAC on new studies.
        studies_qs = studies_qs.filter(
            Q(owner_user=request.user)
            | Q(researcher_access__user=request.user)
            | Q(owner_user__isnull=True, researcher_access__isnull=True)
        ).distinct()

        studies_qs = studies_qs.annotate(
            run_count_agg=Count("run_sessions", distinct=True),
            last_result_at_agg=Max("run_sessions__result_envelope__created_at"),
        ).select_related("owner_user").prefetch_related("config_versions", "researcher_access__user")

        # Materialize once so we can batch-load current-user access records.
        studies_page = list(studies_qs[:100])
        study_ids = [s.id for s in studies_page]

        access_by_study_id = {}
        if study_ids:
            for access in StudyResearcherAccess.objects.filter(study_id__in=study_ids, user=request.user):
                access_by_study_id[access.study_id] = access

        studies = []
        for study in studies_page:
            cfgs = list(study.config_versions.all())
            last_config = cfgs[0] if cfgs else None

            owner_usernames = []
            if study.owner_user_id and getattr(study, "owner_user", None):
                owner_usernames.append(study.owner_user.username)

            for access in study.researcher_access.all():
                username = getattr(access.user, "username", None)
                if username and username not in owner_usernames:
                    owner_usernames.append(username)

            # Fallback for legacy studies with no owner/share rows.
            owner_username = owner_usernames[0] if owner_usernames else _get_study_owner_username(study)
            if owner_username and owner_username not in owner_usernames:
                owner_usernames.append(owner_username)

            if study.owner_user_id == request.user.id:
                permissions = {
                    "can_run_analysis": True,
                    "can_download_aggregate": True,
                    "can_view_run_rows": True,
                    "can_view_pseudonyms": True,
                    "can_view_full_payload": True,
                    "can_manage_sharing": True,
                    "can_remove_users": True,
                }
            else:
                access = access_by_study_id.get(study.id)
                if access:
                    permissions = {
                        "can_run_analysis": access.can_run_analysis,
                        "can_download_aggregate": access.can_download_aggregate,
                        "can_view_run_rows": access.can_view_run_rows,
                        "can_view_pseudonyms": access.can_view_pseudonyms,
                        "can_view_full_payload": access.can_view_full_payload,
                        "can_manage_sharing": access.can_manage_sharing,
                        "can_remove_users": access.can_remove_users,
                    }
                else:
                    # Legacy fallback: permit full access to ownerless studies.
                    permissions = {
                        "can_run_analysis": True,
                        "can_download_aggregate": True,
                        "can_view_run_rows": True,
                        "can_view_pseudonyms": True,
                        "can_view_full_payload": True,
                        "can_manage_sharing": True,
                        "can_remove_users": True,
                    }

            studies.append(
                {
                    "study_slug": study.slug,
                    "study_name": study.name,
                    "runtime_mode": study.runtime_mode,
                    "owner_username": owner_username,
                    "owner_usernames": owner_usernames,
                    "latest_config_version": last_config.version_label if last_config else None,
                    "dashboard_url": f"/portal/studies/{study.slug}",
                    "run_count": study.run_count_agg,
                    "last_result_at": study.last_result_at_agg,
                    "last_activity_at": study.last_result_at_agg or study.updated_at,
                    "permissions": permissions,
                }
            )
        return Response({"studies": studies})


class StudyRunsView(APIView):
    """Return recent run metadata for a study to power dashboard result access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_access_analysis_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

        perms = _study_access_permissions(study, request.user, profile)
        if not perms.get("can_view_run_rows"):
            return Response({"error": "Run-level access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)

        run_batch = list(
            study.run_sessions.select_related("owner_user", "result_envelope", "config_version").order_by("-started_at")[:20]
        )
        run_ids = [str(getattr(run, "id", "") or "").strip() for run in run_batch if str(getattr(run, "id", "") or "").strip()]
        variant_by_run_id = {str(run.id): {
            "flow_variant_id": str(getattr(run, "flow_variant_id", "") or "").strip() or None,
            "flow_variant_label": str(getattr(run, "flow_variant_label", "") or "").strip() or None,
            "has_flow_variant": bool(getattr(run, "has_flow_variant", False)),
        } for run in run_batch if bool(getattr(run, "has_flow_variant", False)) or str(getattr(run, "flow_variant_id", "") or "").strip() or str(getattr(run, "flow_variant_label", "") or "").strip()}
        if run_ids and len(variant_by_run_id) < len(run_batch):
            events = AuditEvent.objects.filter(
                action="start_run",
                resource_type="run_session",
                metadata_json__study_slug=study.slug,
                resource_id__in=run_ids,
            ).order_by("-created_at")
            for event in events:
                run_id = str(getattr(event, "resource_id", "") or "").strip()
                if not run_id or run_id in variant_by_run_id:
                    continue
                metadata = event.metadata_json if isinstance(getattr(event, "metadata_json", None), dict) else {}
                variant_id = str(metadata.get("flow_variant_id") or "").strip()
                variant_label = str(metadata.get("flow_variant_label") or "").strip()
                if variant_id or variant_label:
                    variant_by_run_id[run_id] = {
                        "flow_variant_id": variant_id or None,
                        "flow_variant_label": variant_label or (variant_id or None),
                        "has_flow_variant": True,
                    }

        runs = []
        for run in run_batch:
            envelope = getattr(run, "result_envelope", None)
            cfg = getattr(run, "config_version", None)
            cfg_json = cfg.config_json if cfg and isinstance(cfg.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            variant_meta = variant_by_run_id.get(str(getattr(run, "id", "") or "").strip(), {})
            runs.append(
                {
                    "run_session_id": run.id,
                    "status": run.status,
                    "started_at": run.started_at,
                    "completed_at": run.completed_at,
                    "owner_username": run.owner_user.username if run.owner_user else _get_study_owner_username(study),
                    "participant_key_preview": (
                        f"{run.participant_key[:12]}..."
                        if (run.participant_key and perms.get("can_view_pseudonyms"))
                        else None
                    ),
                    "task_type": task_type,
                    "config_version_id": cfg.id if cfg else None,
                    "config_version_label": cfg.version_label if cfg else None,
                    "flow_variant_id": variant_meta.get("flow_variant_id"),
                    "flow_variant_label": variant_meta.get("flow_variant_label"),
                    "has_flow_variant": bool(variant_meta.get("has_flow_variant", False)),
                    "has_result": bool(envelope),
                    "trial_count": envelope.trial_count if envelope else 0,
                    "result_created_at": envelope.created_at if envelope else None,
                }
            )

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "runs": runs,
            },
            status=status.HTTP_200_OK,
        )


class StudyAnalysisReportView(APIView):
    """Generate a direct preview using the shared report-rendering pipeline."""

    def post(self, request):
        serializer = StudyAnalysisReportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _profile, perms, error = _require_study_analysis_access(request, data["study_slug"])
        if error:
            return error

        options = dict(data.get("options") or {})
        if options.get("include_participant_summary") and not perms.get("can_view_run_rows"):
            return Response(
                {"error": "Per-participant summaries require run-level access (can_view_run_rows). Contact the study owner to request this permission."},
                status=status.HTTP_403_FORBIDDEN,
            )

        outputs = build_study_analysis_outputs(
            study=study,
            engine=data["engine"],
            options=options,
            include_completed_only=bool(data.get("include_completed_only", True)),
        )
        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "engine": outputs["engine"],
                "options": outputs["options"],
                "overview": outputs["overview"],
                "coverage": outputs["coverage"],
                "numeric_summary": outputs["numeric_summary"],
                "participant_numeric_summary": outputs.get("participant_numeric_summary") or [],
                "variant_numeric_summary": outputs.get("variant_numeric_summary") or [],
                "report_markdown": outputs["report_markdown"],
                "r_markdown_document": outputs["r_markdown_document"],
                "can_knit_on_platform": True,
                "can_generate_pdf_on_platform": True,
            },
            status=status.HTTP_200_OK,
        )


class StudyAnalysisReportJobsView(APIView):
    """Queue and inspect asynchronous analysis report jobs."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study_slug = (request.query_params.get("study_slug") or "").strip()
        include_defaults = str(request.query_params.get("include_defaults") or "").strip().lower() in {"1", "true", "yes"}
        jobs_qs = StudyAnalysisReportJob.objects.select_related("study", "requested_by").prefetch_related("artifacts")

        if study_slug:
            study, _profile, _perms, error = _require_study_analysis_access(request, study_slug)
            if error:
                return error
            jobs_qs = jobs_qs.filter(study=study)
            defaults = infer_study_analysis_defaults(study=study, include_completed_only=True) if include_defaults else None
        else:
            jobs_qs = jobs_qs.filter(requested_by=request.user)
            defaults = None

        return Response(
            {
                "jobs": [_serialize_report_job(job) for job in jobs_qs[:25]],
                "analysis_defaults": defaults,
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def post(self, request):
        serializer = StudyAnalysisReportJobCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _profile, perms, error = _require_study_analysis_access(request, data["study_slug"])
        if error:
            return error

        options = dict(data.get("options") or {})
        if options.get("include_participant_summary") and not perms.get("can_view_run_rows"):
            return Response(
                {"error": "Per-participant summaries require run-level access (can_view_run_rows). Contact the study owner to request this permission."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Rate limit: max 5 queued/running jobs per user per study in the last hour
        one_hour_ago = timezone.now() - timedelta(hours=1)
        recent_active = StudyAnalysisReportJob.objects.filter(
            study=study,
            requested_by=request.user,
            status__in=[StudyAnalysisReportJob.STATUS_QUEUED, StudyAnalysisReportJob.STATUS_RUNNING],
            created_at__gte=one_hour_ago,
        ).count()
        if recent_active >= 5:
            return Response(
                {"error": "Rate limit exceeded: at most 5 active report jobs per study per hour. Wait for existing jobs to complete."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        requested_formats = list(data.get("requested_formats") or ["markdown", "html", "pdf", "snapshot"])
        if data["engine"] == "r" and "rmd" not in requested_formats:
            requested_formats.append("rmd")

        job = StudyAnalysisReportJob.objects.create(
            study=study,
            requested_by=request.user,
            status=StudyAnalysisReportJob.STATUS_QUEUED,
            engine=data["engine"],
            requested_formats=requested_formats,
            include_completed_only=bool(data.get("include_completed_only", True)),
            options=options,
            permissions_snapshot=perms,
        )
        record_audit(
            action="analysis_report_job_requested",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "engine": job.engine,
                "requested_formats": job.requested_formats,
            },
        )
        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_202_ACCEPTED)


class StudyAnalysisReportJobDetailView(APIView):
    def get(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study", "requested_by").prefetch_related("artifacts").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_200_OK)


class StudyAnalysisReportArtifactDownloadView(APIView):
    def get(self, request, job_id: int, artifact_format: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        artifact_format = str(artifact_format or "").strip().lower()
        artifact = (
            StudyAnalysisReportArtifact.objects.select_related("job", "job__study")
            .filter(job_id=job_id, artifact_format=artifact_format)
            .first()
        )
        if not artifact:
            return Response({"error": "Artifact not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, artifact.job.study.slug)
        if error:
            return error

        record_audit(
            action="analysis_report_artifact_downloaded",
            resource_type="study_report_job",
            resource_id=artifact.job.id,
            actor=request.user.username,
            metadata={
                "study_slug": artifact.job.study.slug,
                "artifact_format": artifact.artifact_format,
                "file_name": artifact.file_name,
            },
        )

        content = artifact.binary_content if artifact.binary_content else (artifact.text_content or "")
        response = HttpResponse(content, content_type=artifact.mime_type)
        response["Content-Disposition"] = f'attachment; filename="{artifact.file_name}"'
        return response


class StudyAnalysisReportJobCancelView(APIView):
    """Cancel a queued report job (only queued jobs may be cancelled)."""

    def post(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        if job.requested_by_id and job.requested_by_id != request.user.id:
            return Response({"error": "You can only cancel your own jobs"}, status=status.HTTP_403_FORBIDDEN)

        if job.status not in (StudyAnalysisReportJob.STATUS_QUEUED,):
            return Response(
                {"error": f"Job cannot be cancelled in status '{job.status}'. Only queued jobs may be cancelled."},
                status=status.HTTP_409_CONFLICT,
            )

        job.status = StudyAnalysisReportJob.STATUS_FAILED
        job.error_message = "Cancelled by user"
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "error_message", "completed_at", "updated_at"])

        record_audit(
            action="analysis_report_job_cancelled",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={"study_slug": job.study.slug},
        )
        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_200_OK)


class StudyAnalysisReportJobDeleteView(APIView):
    """Delete a completed or failed report job and all its artifacts."""

    def delete(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        if job.requested_by_id and job.requested_by_id != request.user.id:
            return Response({"error": "You can only delete your own jobs"}, status=status.HTTP_403_FORBIDDEN)

        if job.status in (StudyAnalysisReportJob.STATUS_QUEUED, StudyAnalysisReportJob.STATUS_RUNNING):
            return Response(
                {"error": "Cannot delete an active job. Cancel it first."},
                status=status.HTTP_409_CONFLICT,
            )

        record_audit(
            action="analysis_report_job_deleted",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={"study_slug": job.study.slug, "status": job.status},
        )
        job.delete()
        return Response({"ok": True}, status=status.HTTP_200_OK)


class StudyLatestConfigView(APIView):
    """Return the latest published config JSON for a study the researcher can access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            _record_auth_rejection(
                request,
                endpoint="studies/latest-config",
                reason="unauthenticated",
                metadata={"study_slug": study_slug},
            )
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response(
                {
                    "error": "Study configuration access requires researcher or platform_admin role",
                    "current_role": profile.role,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if (
            not _has_study_access(study, request.user, profile)
            and not _is_legacy_public_study(study)
            and not _is_study_publish_actor(study, request.user)
        ):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        versions = list(study.config_versions.all())
        config_version = versions[0] if versions else None
        if not config_version:
            return Response({"error": "No published config version"}, status=status.HTTP_404_NOT_FOUND)

        configs = []
        available_task_types = []
        for v in versions:
            cfg_json = v.config_json if isinstance(v.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            if task_type and task_type not in available_task_types:
                available_task_types.append(task_type)
            configs.append(
                {
                    "config_version_id": v.id,
                    "config_version_label": v.version_label,
                    "task_type": task_type,
                    "config": v.config_json,
                }
            )

        latest_task_type = (config_version.config_json.get("task_type") or config_version.config_json.get("taskType") or "") if isinstance(config_version.config_json, dict) else ""
        latest_task_type = str(latest_task_type).strip().lower() or None

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "task_type": latest_task_type,
                "available_task_types": available_task_types,
                "configs": configs,
                "study_properties": _normalize_study_launch_properties(study, versions),
                "config": config_version.config_json,
            },
            status=status.HTTP_200_OK,
        )


class StudyPropertiesView(APIView):
    """Persist study-level task labels/order and flow variants for launch orchestration."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response(
                {
                    "error": "Study configuration access requires researcher or platform_admin role",
                    "current_role": profile.role,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if (
            not _has_study_access(study, request.user, profile)
            and not _is_legacy_public_study(study)
            and not _is_study_publish_actor(study, request.user)
        ):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = StudyPropertiesRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        versions = list(study.config_versions.all())
        normalized = _normalize_study_launch_properties(study, versions, raw_properties=serializer.validated_data)
        study.launch_properties_json = {
            "task_profile": normalized["task_profile"],
            "flow_variants": [
                {
                    "id": variant["id"],
                    "label": variant["label"],
                    "task_order": variant["task_order"],
                }
                for variant in normalized["flow_variants"]
            ],
        }
        study.save(update_fields=["launch_properties_json", "updated_at"])

        record_audit(
            action="study_properties_updated",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "task_count": len(normalized["task_profile"].get("items", [])),
                "flow_variant_count": len(normalized["flow_variants"]),
            },
        )

        return Response(
            {
                "study_slug": study.slug,
                "study_properties": normalized,
            },
            status=status.HTTP_200_OK,
        )


class StudyTakeToGoBundleView(APIView):
    """Generate a downloadable local runtime bundle (Interpreter + PyLSL bridge)."""

    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response(
                {
                    "error": "Take-to-go export requires researcher or platform_admin role",
                    "current_role": profile.role,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if (
            not _has_study_access(study, request.user, profile)
            and not _is_legacy_public_study(study)
            and not _is_study_publish_actor(study, request.user)
        ):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        include_all_versions = str(request.data.get("include_all_versions", "true")).strip().lower() in {"1", "true", "yes", "on"}
        bundle_system = _normalize_take_to_go_system(request.data.get("bundle_system", "generic"))
        if not bundle_system:
            return Response(
                {
                    "error": "Invalid bundle_system. Expected one of: generic, biosemi, brainproducts",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            request_metadata = _normalize_take_to_go_metadata_payload(request.data.get("interpreter_metadata"))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        versions = list(study.config_versions.all())
        if not versions:
            return Response({"error": "No published config version"}, status=status.HTTP_404_NOT_FOUND)

        selected_versions = versions if include_all_versions else versions[:1]
        metadata_files = _build_take_to_go_metadata_files(
            study,
            selected_versions,
            include_all_versions,
            bundle_system,
            request_metadata,
        )

        try:
            zip_bytes, zip_name, meta = _build_take_to_go_bundle_zip(
                study,
                selected_versions,
                bundle_system=bundle_system,
                metadata_files=metadata_files,
            )
        except Exception as exc:
            return Response({"error": f"Bundle generation failed: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        record_audit(
            action="study_take_to_go_export",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "include_all_versions": include_all_versions,
                "bundle_system": bundle_system,
                **meta,
            },
        )

        response = HttpResponse(zip_bytes, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{zip_name}"'
        response["Cache-Control"] = "no-store"
        return response


class PublishConfigView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = PublishConfigRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)
        profile = None
        if request.user.is_authenticated:
            profile = get_or_create_profile(request.user)

        existing_study = Study.objects.filter(slug=data["study_slug"]).first()
        if existing_study and request.user.is_authenticated:
            if existing_study.owner_user_id and not _has_study_access(existing_study, request.user, profile):
                return Response(
                    {"error": "Study is not shared with the current researcher"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if existing_study:
            study = existing_study
            study.name = data["study_name"]
            study.runtime_mode = data["runtime_mode"]
            study.save(update_fields=["name", "runtime_mode"])
        else:
            study = Study.objects.create(
                slug=data["study_slug"],
                name=data["study_name"],
                runtime_mode=data["runtime_mode"],
            )

        if request.user.is_authenticated:
            if study.owner_user_id and not _has_study_access(study, request.user, profile):
                return Response(
                    {"error": "Study is not shared with the current researcher"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if not study.owner_user_id or study.owner_user_id == request.user.id:
                if study.owner_user_id != request.user.id:
                    study.owner_user = request.user
                    study.save(update_fields=["owner_user"])
                _ensure_owner_access_record(study, request.user, granted_by=request.user)
            elif study.owner_user_id != request.user.id:
                StudyResearcherAccess.objects.get_or_create(
                    study=study,
                    user=request.user,
                    defaults={"granted_by": request.user},
                )

        requested_version_label = data["config_version_label"]
        incoming_task_type = _extract_config_task_type(data.get("config"))
        label_adjusted = False

        existing_same_label = ConfigVersion.objects.filter(
            study=study,
            version_label=requested_version_label,
        ).first()

        if not existing_same_label:
            config_version = ConfigVersion.objects.create(
                study=study,
                version_label=requested_version_label,
                builder_version=data.get("builder_version", ""),
                config_json=data["config"],
            )
        else:
            existing_task_type = _extract_config_task_type(existing_same_label.config_json)
            same_task_type = bool(incoming_task_type) and bool(existing_task_type) and (incoming_task_type == existing_task_type)
            same_content = (existing_same_label.config_json == data["config"])

            if same_task_type or same_content:
                existing_same_label.builder_version = data.get("builder_version", "")
                existing_same_label.config_json = data["config"]
                existing_same_label.save(update_fields=["builder_version", "config_json"])
                config_version = existing_same_label
            else:
                suffix = incoming_task_type or "task"
                safe_suffix = re.sub(r"[^a-z0-9_-]", "-", suffix.lower()).strip("-") or "task"
                candidate = f"{requested_version_label}__{safe_suffix}"
                n = 2
                while ConfigVersion.objects.filter(study=study, version_label=candidate).exists():
                    candidate = f"{requested_version_label}__{safe_suffix}-{n}"
                    n += 1

                config_version = ConfigVersion.objects.create(
                    study=study,
                    version_label=candidate,
                    builder_version=data.get("builder_version", ""),
                    config_json=data["config"],
                )
                label_adjusted = True

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="publish_config",
            resource_type="study",
            resource_id=study.id,
            actor=actor,
            metadata={
                "requested_version_label": requested_version_label,
                "version_label": config_version.version_label,
                "version_label_adjusted": label_adjusted,
                "task_type": incoming_task_type,
            },
        )

        return Response(
            {
                "study_id": study.id,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "requested_config_version_label": requested_version_label,
                "config_version_label_adjusted": label_adjusted,
                "study_slug": study.slug,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "dashboard_url": f"/portal/studies/{study.slug}",
            },
            status=status.HTTP_201_CREATED,
        )


class UploadBuilderAssetView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Missing file"}, status=status.HTTP_400_BAD_REQUEST)

        max_bytes = int(os.getenv("BUILDER_ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
        if (getattr(uploaded, "size", 0) or 0) > max_bytes:
            return Response({"error": f"File too large (max {max_bytes} bytes)"}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        original_name = (uploaded.name or "asset").strip() or "asset"
        ext = os.path.splitext(original_name.lower())[1]
        allowed_exts = {
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif",
            ".mp3", ".wav", ".ogg", ".m4a",
            ".mp4", ".webm",
        }
        if ext not in allowed_exts:
            return Response({"error": f"Unsupported asset type: {ext or 'unknown'}"}, status=status.HTTP_400_BAD_REQUEST)

        content_type = (uploaded.content_type or "").strip().lower()
        if content_type and not (
            content_type.startswith("image/")
            or content_type.startswith("audio/")
            or content_type.startswith("video/")
        ):
            return Response({"error": f"Unsupported content type: {content_type}"}, status=status.HTTP_400_BAD_REQUEST)

        study_slug = (request.data.get("study_slug") or "").strip()
        study = None
        scope_slug = "unscoped"

        if study_slug:
            study = Study.objects.filter(slug=study_slug).first()
            if not study:
                return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)
            if not _has_study_access(study, request.user, profile):
                return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)
            scope_slug = study.slug

        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        safe_name = re.sub(r"_+", "_", safe_name).strip("._")
        if not safe_name:
            safe_name = "asset"

        rel_path = default_storage.save(
            f"builder-assets/u{request.user.id}/{scope_slug}/{uuid4().hex[:12]}-{safe_name}",
            uploaded,
        )
        rel_path = rel_path.replace("\\", "/")

        try:
            public_url = request.build_absolute_uri(f"/api/v1/assets/file/{quote(rel_path, safe='/')}")
        except Exception:
            public_url = request.build_absolute_uri(f"/api/v1/assets/file/{quote(rel_path, safe='/')}")

        return Response(
            {
                "ok": True,
                "url": public_url,
                "path": rel_path,
                "study_slug": study.slug if study else None,
                "filename": original_name,
                "uploader_user_id": request.user.id,
            },
            status=status.HTTP_201_CREATED,
        )


class DownloadBuilderAssetView(APIView):
    def get(self, request, asset_path: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        normalized = (asset_path or "").replace("\\", "/").strip("/")
        if not normalized.startswith("builder-assets/"):
            return Response({"error": "Invalid builder asset path"}, status=status.HTTP_400_BAD_REQUEST)

        m = re.match(r"^builder-assets/u(?P<uid>\d+)/(?P<scope>[^/]+)/.+$", normalized)
        if not m:
            return Response({"error": "Forbidden asset scope"}, status=status.HTTP_403_FORBIDDEN)

        owner_user_id = int(m.group("uid"))
        if owner_user_id != request.user.id:
            return Response({"error": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if not default_storage.exists(normalized):
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)

        fh = default_storage.open(normalized, mode="rb")
        guessed_type, _ = mimetypes.guess_type(normalized)
        response = FileResponse(fh, content_type=guessed_type or "application/octet-stream")
        response["Cache-Control"] = "private, max-age=0, no-cache"
        return response


class CreateParticipantLinkView(APIView):
    """Generate signed participant launch links for a researcher-owned study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            _record_auth_rejection(
                request,
                endpoint="studies/participant-links",
                reason="unauthenticated",
                metadata={"study_slug": study_slug},
            )
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response(
                {
                    "error": "Generate Links requires researcher or platform_admin role",
                    "current_role": profile.role,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        owner_username = _get_study_owner_username(study)
        if (
            not _has_study_access(study, request.user, profile)
            and not _is_legacy_public_study(study)
            and not _is_study_publish_actor(study, request.user)
        ):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CreateParticipantLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        config_versions = list(study.config_versions.all())
        study_properties = _normalize_study_launch_properties(study, config_versions)
        known_ids = {str(cv.id) for cv in config_versions}

        expires_at = timezone.now() + timedelta(hours=data.get("expires_in_hours", 72))
        participant_external_id = (data.get("participant_external_id") or "").strip()
        counterbalance_enabled = bool(data.get("counterbalance_enabled", True))
        use_flow_variants = bool(data.get("use_flow_variants", False))
        task_order_strict = bool(data.get("task_order_strict", False))
        raw_task_order = data.get("task_order") or []
        task_order = []
        for raw in raw_task_order:
            sid = str(raw or "").strip()
            if not sid or sid not in known_ids or sid in task_order:
                continue
            task_order.append(sid)
        if use_flow_variants and not study_properties.get("flow_variants"):
            return Response({"error": "No saved study variants are available for this study"}, status=status.HTTP_400_BAD_REQUEST)
        completion_redirect_url = (data.get("completion_redirect_url") or "").strip()
        abort_redirect_url = (data.get("abort_redirect_url") or "").strip()
        prolific_completion_mode = (data.get("prolific_completion_mode") or "default").strip() or "default"
        prolific_completion_code = (data.get("prolific_completion_code") or "").strip()
        base_payload = {
            "study_slug": study.slug,
            "researcher_username": request.user.username,
            "participant_external_id": participant_external_id,
            "counterbalance_enabled": counterbalance_enabled,
            "use_flow_variants": use_flow_variants,
            "task_order": task_order,
            "task_order_strict": task_order_strict,
            "expires_at": expires_at.isoformat(),
            "completion_redirect_url": completion_redirect_url,
            "abort_redirect_url": abort_redirect_url,
            "prolific_completion_mode": prolific_completion_mode,
            "prolific_completion_code": prolific_completion_code,
        }
        single_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "single_use",
            }
        )
        multi_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "multi_use",
            }
        )

        record_audit(
            action="create_participant_link",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "expires_at": expires_at.isoformat(),
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
                "prolific_completion_mode": prolific_completion_mode,
                "has_prolific_completion_code": bool(prolific_completion_code),
                "counterbalance_enabled": counterbalance_enabled,
                "use_flow_variants": use_flow_variants,
                "task_order_count": len(task_order),
                "task_order_strict": task_order_strict,
                "flow_variant_count": len(study_properties.get("flow_variants") or []),
                "single_use_token_digest": _launch_token_digest(single_use_token),
                "multi_use_token_digest": _launch_token_digest(multi_use_token),
            },
        )

        launch_url_multi = f"/interpreter/index.html?launch={multi_use_token}"
        launch_url_single = f"/interpreter/index.html?launch={single_use_token}"
        return Response(
            {
                "study_slug": study.slug,
                "launch_token": multi_use_token,
                "launch_url": launch_url_multi,
                "counterbalance_enabled": counterbalance_enabled,
                "use_flow_variants": use_flow_variants,
                "task_order": task_order,
                "task_order_strict": task_order_strict,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "prolific_completion_mode": prolific_completion_mode,
                "prolific_completion_code": prolific_completion_code,
                "launch_options": {
                    "multi_use": {
                        "launch_mode": "multi_use",
                        "launch_token": multi_use_token,
                        "launch_url": launch_url_multi,
                        "counterbalance_enabled": counterbalance_enabled,
                        "use_flow_variants": use_flow_variants,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                    "single_use": {
                        "launch_mode": "single_use",
                        "launch_token": single_use_token,
                        "launch_url": launch_url_single,
                        "counterbalance_enabled": counterbalance_enabled,
                        "use_flow_variants": use_flow_variants,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                },
                "expires_at": expires_at,
                "owner_username": owner_username or request.user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_201_CREATED,
        )


class AssignStudyOwnerView(APIView):
    """Allow platform admins to reassign researcher ownership for a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if profile.role != profile.ROLE_ADMIN:
            return Response({"error": "Platform admin role required"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = AssignStudyOwnerRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["owner_username"].strip()

        new_owner = User.objects.filter(username=target_username).first()
        if not new_owner:
            return Response({"error": "Owner user not found"}, status=status.HTTP_404_NOT_FOUND)

        study.owner_user = new_owner
        study.save(update_fields=["owner_user"])
        _ensure_owner_access_record(study, new_owner, granted_by=request.user)

        record_audit(
            action="assign_study_owner",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "new_owner_username": new_owner.username,
            },
        )

        return Response(
            {
                "study_slug": study.slug,
                "owner_username": new_owner.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class ShareStudyView(APIView):
    """Share a study with another user by username and granular study permissions."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)
        if study.owner_user_id != request.user.id:
            return Response({"error": "Only the study owner can manage sharing"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ShareStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()
        requested_permissions = {
            "can_remove_users": bool(serializer.validated_data.get("can_remove_users", False)),
            "can_run_analysis": bool(serializer.validated_data.get("can_run_analysis", True)),
            "can_download_aggregate": bool(serializer.validated_data.get("can_download_aggregate", True)),
            "can_view_run_rows": bool(serializer.validated_data.get("can_view_run_rows", False)),
            "can_view_pseudonyms": bool(serializer.validated_data.get("can_view_pseudonyms", False)),
            "can_view_full_payload": bool(serializer.validated_data.get("can_view_full_payload", False)),
            "can_manage_sharing": bool(serializer.validated_data.get("can_manage_sharing", False)),
        }

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        if not target_user.is_active:
            return Response({"error": "User account is inactive"}, status=status.HTTP_400_BAD_REQUEST)

        target_profile = get_or_create_profile(target_user)
        if target_profile.role not in {
            target_profile.ROLE_RESEARCHER,
            target_profile.ROLE_ADMIN,
            target_profile.ROLE_ANALYST,
        }:
            return Response(
                {"error": "Only researcher/admin/analyst accounts can receive study shares"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        already_owner = study.owner_user_id == target_user.id
        created = False
        permission_updated = False
        if not already_owner:
            access, created = StudyResearcherAccess.objects.get_or_create(
                study=study,
                user=target_user,
                defaults={
                    "granted_by": request.user,
                    **requested_permissions,
                },
            )
            if not created:
                updated_fields = []
                for key, value in requested_permissions.items():
                    if getattr(access, key) != value:
                        setattr(access, key, value)
                        updated_fields.append(key)
                if updated_fields:
                    access.save(update_fields=updated_fields)
                    permission_updated = True
        effective_permissions = requested_permissions if not already_owner else _study_access_permissions(study, target_user, target_profile)

        record_audit(
            action="share_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_owner": already_owner,
                "created": created,
                "permissions": effective_permissions,
                "permission_updated": permission_updated,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_shared": already_owner or (not created),
                "permissions": effective_permissions,
                "permission_updated": permission_updated,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class ShareStudyValidateUserView(APIView):
    """Validate a target username for sharing without exposing user listings."""

    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)
        if study.owner_user_id != request.user.id:
            return Response({"error": "Only the study owner can manage sharing"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ShareStudyValidateUserRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"exists": False, "eligible": False}, status=status.HTTP_200_OK)
        if not target_user.is_active:
            return Response({"exists": True, "eligible": False, "reason": "inactive"}, status=status.HTTP_200_OK)

        target_profile = get_or_create_profile(target_user)
        eligible = target_profile.role in {
            target_profile.ROLE_RESEARCHER,
            target_profile.ROLE_ANALYST,
            target_profile.ROLE_ADMIN,
        }
        return Response(
            {
                "exists": True,
                "eligible": eligible,
                "role": target_profile.role if eligible else None,
                "is_owner": bool(study.owner_user_id == target_user.id),
            },
            status=status.HTTP_200_OK,
        )


class RevokeStudyAccessView(APIView):
    """Remove researcher collaboration access from a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(request.user)
        if not _can_manage_study_scope(request, profile, study):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

        if not _can_remove_study_users(study, request.user, profile):
            return Response({"error": "You do not have permission to remove users for this study"}, status=status.HTTP_403_FORBIDDEN)

        serializer = RevokeStudyAccessRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if study.owner_user_id == target_user.id:
            return Response({"error": "Cannot remove the study owner"}, status=status.HTTP_400_BAD_REQUEST)

        access = StudyResearcherAccess.objects.filter(study=study, user=target_user).first()
        if not access:
            return Response({"error": "User does not currently have collaborator access"}, status=status.HTTP_400_BAD_REQUEST)

        access.delete()

        record_audit(
            action="revoke_study_access",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "revoked_username": target_user.username,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "revoked_username": target_user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class DuplicateStudyView(APIView):
    """Duplicate a study and clone its latest published config for further editing."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        source_study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not source_study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(source_study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = DuplicateStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        requested_name = (serializer.validated_data.get("study_name") or "").strip()
        requested_slug = (serializer.validated_data.get("study_slug") or "").strip()

        new_study_name = requested_name or f"{source_study.name} (Copy)"
        base_slug = slugify(requested_slug or new_study_name) or slugify(f"{source_study.slug}-copy") or "study-copy"
        if base_slug == source_study.slug:
            base_slug = f"{base_slug}-copy"

        candidate_slug = base_slug
        n = 2
        while Study.objects.filter(slug=candidate_slug).exists():
            candidate_slug = f"{base_slug}-{n}"
            n += 1

        source_config = source_study.config_versions.first()
        if not source_config:
            return Response({"error": "No published config version found to duplicate"}, status=status.HTTP_400_BAD_REQUEST)

        duplicated_study = Study.objects.create(
            slug=candidate_slug,
            name=new_study_name,
            runtime_mode=source_study.runtime_mode,
            owner_user=request.user,
            is_active=True,
        )

        duplicated_config = ConfigVersion.objects.create(
            study=duplicated_study,
            version_label=source_config.version_label,
            builder_version=source_config.builder_version,
            config_json=source_config.config_json,
        )

        record_audit(
            action="duplicate_study",
            resource_type="study",
            resource_id=duplicated_study.id,
            actor=request.user.username,
            metadata={
                "source_study_slug": source_study.slug,
                "duplicated_study_slug": duplicated_study.slug,
                "source_config_version_id": source_config.id,
                "duplicated_config_version_id": duplicated_config.id,
            },
        )

        return Response(
            {
                "ok": True,
                "source_study_slug": source_study.slug,
                "study_slug": duplicated_study.slug,
                "study_name": duplicated_study.name,
                "runtime_mode": duplicated_study.runtime_mode,
                "owner_username": _get_study_owner_username(duplicated_study),
                "owner_usernames": _get_study_owner_usernames(duplicated_study),
                "config_version_id": duplicated_config.id,
                "config_version_label": duplicated_config.version_label,
            },
            status=status.HTTP_201_CREATED,
        )


class DeleteStudyView(APIView):
    """Soft-delete (deactivate) a study while retaining all audit/config/result records."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        config_count = study.config_versions.count()
        run_count = study.run_sessions.count()
        result_count = ResultEnvelope.objects.filter(run_session__study=study).count()

        study.is_active = False
        study.updated_at = timezone.now()
        study.save(update_fields=["is_active", "updated_at"])

        record_audit(
            action="delete_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "study_name": study.name,
                "config_versions_retained": config_count,
                "run_sessions_retained": run_count,
                "result_envelopes_retained": result_count,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "study_name": study.name,
                "is_active": study.is_active,
                "retained": {
                    "config_versions": config_count,
                    "run_sessions": run_count,
                    "result_envelopes": result_count,
                },
            },
            status=status.HTTP_200_OK,
        )


class DeleteStudyConfigVersionView(APIView):
    """Delete one config version from a study when it is safe to remove."""

    @transaction.atomic
    def post(self, request, study_slug: str, config_version_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        if not _can_remove_study_users(study, request.user, profile):
            return Response({"error": "You do not have permission to manage config versions for this study"}, status=status.HTTP_403_FORBIDDEN)

        config_version = ConfigVersion.objects.filter(study=study, id=config_version_id).first()
        if not config_version:
            return Response({"error": "Config version not found"}, status=status.HTTP_404_NOT_FOUND)

        remaining_count = study.config_versions.exclude(id=config_version.id).count()
        if remaining_count < 1:
            return Response(
                {"error": "At least one config version must remain in the study"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        run_count = RunSession.objects.filter(config_version=config_version).count()
        if run_count > 0:
            return Response(
                {"error": "This config version has run history and cannot be deleted"},
                status=status.HTTP_409_CONFLICT,
            )

        version_label = config_version.version_label

        try:
            config_version.delete()
        except ProtectedError:
            return Response(
                {"error": "This config version is referenced by other records and cannot be deleted"},
                status=status.HTTP_409_CONFLICT,
            )

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="delete_config_version",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "deleted_config_version_id": config_version_id,
                "deleted_config_version_label": version_label,
                "remaining_config_versions": remaining_count,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "deleted_config_version_id": config_version_id,
                "deleted_config_version_label": version_label,
                "remaining_config_versions": remaining_count,
            },
            status=status.HTTP_200_OK,
        )


