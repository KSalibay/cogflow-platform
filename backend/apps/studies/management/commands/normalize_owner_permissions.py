from django.core.management.base import BaseCommand
from django.db import transaction

from apps.studies.models import Study
from project.api_views_common import _ensure_owner_access_record


class Command(BaseCommand):
    help = "Backfill full collaborator permissions for each study owner."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing to the database.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))

        studies_qs = Study.objects.select_related("owner_user").filter(owner_user__isnull=False)
        total = studies_qs.count()
        updated = 0
        owner_perm_keys = (
            "can_run_analysis",
            "can_download_aggregate",
            "can_view_run_rows",
            "can_view_pseudonyms",
            "can_view_full_payload",
            "can_manage_sharing",
            "can_remove_users",
        )

        for study in studies_qs.iterator():
            owner = study.owner_user
            before = study.researcher_access.filter(user=owner).first()

            if dry_run:
                if before is None:
                    updated += 1
                else:
                    for key in owner_perm_keys:
                        if not bool(getattr(before, key)):
                            updated += 1
                            break
                continue

            needs_update = before is None or any(not bool(getattr(before, key)) for key in owner_perm_keys)
            if needs_update:
                updated += 1
            _ensure_owner_access_record(study, owner, granted_by=owner)

        if dry_run:
            transaction.set_rollback(True)

        mode = "DRY RUN" if dry_run else "APPLIED"
        self.stdout.write(
            self.style.SUCCESS(
                f"[{mode}] Checked {total} owner-backed studies; normalized owner permissions for {updated}."
            )
        )
