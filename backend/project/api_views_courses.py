from .api_views_common import *


def _course_payload(course, membership=None, include_code=False):
    payload = {
        "id": course.id,
        "course_name": course.course_name,
        "section_name": course.section_name,
        "instructor_username": course.instructor_user.username,
        "is_active": course.is_active,
        "enrollment_closes_at": course.enrollment_closes_at,
        "membership_role": membership.role if membership else None,
        "student_count": course.memberships.filter(role=CourseMembership.ROLE_STUDENT).count(),
        "study_count": course.studies.count(),
        "enrollment_code_hint": course.enrollment_code_hint,
    }
    if include_code:
        payload["enrollment_code"] = include_code
    return payload


class CourseSectionsView(APIView):
    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        memberships = list(
            CourseMembership.objects.filter(user=request.user)
            .select_related("course_section", "course_section__instructor_user")
            .order_by("course_section__course_name", "course_section__section_name")
        )
        return Response(
            {"courses": [_course_payload(item.course_section, item) for item in memberships]},
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        profile = get_or_create_profile(request.user)
        if profile.role not in {profile.ROLE_ADMIN, profile.ROLE_INSTRUCTOR}:
            return Response({"error": "Instructor role required"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseSectionCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        course_name = data["course_name"].strip()
        section_name = data["section_name"].strip()
        if not course_name or not section_name:
            return Response({"error": "Course and section names are required"}, status=status.HTTP_400_BAD_REQUEST)
        if CourseSection.objects.filter(
            instructor_user=request.user,
            course_name__iexact=course_name,
            section_name__iexact=section_name,
        ).exists():
            return Response({"error": "This course section already exists"}, status=status.HTTP_400_BAD_REQUEST)

        enrollment_code, digest = _generate_enrollment_code()
        course = CourseSection.objects.create(
            course_name=course_name,
            section_name=section_name,
            instructor_user=request.user,
            enrollment_code_digest=digest,
            enrollment_code_hint=enrollment_code[-4:],
            enrollment_closes_at=data.get("enrollment_closes_at"),
        )
        membership = CourseMembership.objects.create(
            course_section=course,
            user=request.user,
            role=CourseMembership.ROLE_INSTRUCTOR,
        )
        record_audit(
            action="course_section_created",
            resource_type="course_section",
            resource_id=course.id,
            actor=request.user.username,
            metadata={"course_name": course.course_name, "section_name": course.section_name},
        )
        return Response(_course_payload(course, membership, include_code=enrollment_code), status=status.HTTP_201_CREATED)


class CourseEnrollView(APIView):
    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        profile = get_or_create_profile(request.user)
        if profile.role != profile.ROLE_STUDENT:
            return Response({"error": "Student role required"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseEnrollRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course = _course_for_enrollment_code(serializer.validated_data["enrollment_code"])
        if not course:
            return Response({"error": "Enrollment code is invalid, closed, or expired"}, status=status.HTTP_400_BAD_REQUEST)

        membership, created = CourseMembership.objects.get_or_create(
            course_section=course,
            user=request.user,
            defaults={"role": CourseMembership.ROLE_STUDENT},
        )
        if not created and membership.role != CourseMembership.ROLE_STUDENT:
            return Response({"error": "Existing course role cannot be replaced"}, status=status.HTTP_409_CONFLICT)
        record_audit(
            action="course_student_enrolled",
            resource_type="course_section",
            resource_id=course.id,
            actor=request.user.username,
            metadata={"created": created},
        )
        return Response(_course_payload(course, membership), status=status.HTTP_200_OK)


class CourseEnrollmentCodeView(APIView):
    @transaction.atomic
    def post(self, request, course_id):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        course = CourseSection.objects.filter(id=course_id).select_related("instructor_user").first()
        if not course:
            return Response({"error": "Course section not found"}, status=status.HTTP_404_NOT_FOUND)
        profile = get_or_create_profile(request.user)
        if course.instructor_user_id != request.user.id and profile.role != profile.ROLE_ADMIN:
            return Response({"error": "Course instructor access required"}, status=status.HTTP_403_FORBIDDEN)

        enrollment_code, digest = _generate_enrollment_code()
        course.enrollment_code_digest = digest
        course.enrollment_code_hint = enrollment_code[-4:]
        course.save(update_fields=["enrollment_code_digest", "enrollment_code_hint", "updated_at"])
        record_audit(
            action="course_enrollment_code_rotated",
            resource_type="course_section",
            resource_id=course.id,
            actor=request.user.username,
        )
        return Response({"ok": True, "enrollment_code": enrollment_code}, status=status.HTTP_200_OK)


class CourseRosterView(APIView):
    def get(self, request, course_id):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        course = CourseSection.objects.filter(id=course_id).select_related("instructor_user").first()
        if not course:
            return Response({"error": "Course section not found"}, status=status.HTTP_404_NOT_FOUND)
        profile = get_or_create_profile(request.user)
        if course.instructor_user_id != request.user.id and profile.role != profile.ROLE_ADMIN:
            return Response({"error": "Course instructor access required"}, status=status.HTTP_403_FORBIDDEN)

        memberships = course.memberships.select_related("user", "user__profile").order_by("role", "user__username")
        roster = [
            {
                "username": item.user.username,
                "public_name": get_public_name(item.user),
                "role": item.role,
                "joined_at": item.joined_at,
                "study_count": course.studies.filter(owner_user=item.user).count(),
            }
            for item in memberships
        ]
        return Response({"course": _course_payload(course), "roster": roster}, status=status.HTTP_200_OK)
