import time

from django.core.management.base import BaseCommand

from project.study_report_jobs import claim_next_report_job, mark_job_failed, process_report_job

_MAX_RETRIES = 2


class Command(BaseCommand):
    help = "Process queued study analysis report jobs."

    def add_arguments(self, parser):
        parser.add_argument("--poll", action="store_true", help="Keep polling for queued jobs.")
        parser.add_argument("--sleep", type=float, default=2.0, help="Sleep interval between polls in seconds.")

    def handle(self, *args, **options):
        poll = bool(options.get("poll"))
        sleep_seconds = float(options.get("sleep") or 2.0)

        while True:
            job = claim_next_report_job()
            if not job:
                if not poll:
                    self.stdout.write(self.style.SUCCESS("No queued report jobs."))
                    return
                time.sleep(sleep_seconds)
                continue

            self.stdout.write(f"Processing report job {job.id} for study {job.study.slug}")
            last_exc = None
            for attempt in range(1, _MAX_RETRIES + 1):
                try:
                    process_report_job(job)
                    self.stdout.write(self.style.SUCCESS(f"Completed report job {job.id}"))
                    last_exc = None
                    break
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    self.stderr.write(
                        self.style.WARNING(f"Report job {job.id} attempt {attempt}/{_MAX_RETRIES} failed: {exc}")
                    )
                    if attempt < _MAX_RETRIES:
                        time.sleep(1.0)

            if last_exc is not None:
                mark_job_failed(job, str(last_exc))
                self.stderr.write(self.style.ERROR(f"Report job {job.id} permanently failed: {last_exc}"))

            if not poll:
                return
