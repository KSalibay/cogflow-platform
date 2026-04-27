"""Management command: delete old completed/failed report jobs and their artifacts.

Usage:
    python manage.py expire_report_jobs [--days 30] [--dry-run]

Records deleted to stdout. Safe to run on a cron schedule.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.studies.models import StudyAnalysisReportJob


class Command(BaseCommand):
    help = "Delete succeeded/failed report jobs (and their artifacts) older than N days."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Retain jobs completed within this many days (default: 30).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be deleted without actually deleting.",
        )

    def handle(self, *args, **options):
        days = int(options.get("days") or 30)
        dry_run = bool(options.get("dry_run"))
        cutoff = timezone.now() - timedelta(days=days)

        qs = StudyAnalysisReportJob.objects.filter(
            status__in=[StudyAnalysisReportJob.STATUS_SUCCEEDED, StudyAnalysisReportJob.STATUS_FAILED],
            completed_at__lt=cutoff,
        )
        count = qs.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS(f"No expired report jobs found (cutoff: {cutoff.date()})."))
            return

        self.stdout.write(f"Found {count} expired report job(s) (completed before {cutoff.date()}).")
        if dry_run:
            for job in qs.select_related("study")[:50]:
                self.stdout.write(f"  [dry-run] Would delete job #{job.id} ({job.study.slug}, {job.status})")
            if count > 50:
                self.stdout.write(f"  ... and {count - 50} more.")
            self.stdout.write(self.style.WARNING("Dry run — nothing deleted."))
            return

        deleted, _details = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired report job(s) and their artifacts."))
