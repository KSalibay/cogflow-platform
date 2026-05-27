# CogFlow Tutorial Content Production Plan

Purpose: establish a repeatable pipeline for tutorial writing, screenshots, GIF creation, review, and publication.

## 1. Content Types

Primary tutorial formats:
- Quick start guides (10 to 15 min)
- Workflow tutorials (20 to 40 min)
- API integration tutorials
- Security and compliance explainers

Assets required per tutorial:
- written article
- minimum 3 screenshots
- optional GIF for key interaction
- version/date badge

## 2. Publishing Cadence

Weekly target:
- 1 new tutorial per week
- 1 refresh of existing tutorial per week

Monthly target:
- 4 new tutorials
- 4 updated tutorials
- 1 API tutorial refresh synced with API changes

## 3. Production Workflow

### 3.1 Backlog and scoping (Monday)
- Select topics from roadmap and support tickets.
- Assign owner and reviewer.
- Define output format and assets needed.

### 3.2 Drafting (Tuesday to Wednesday)
- Write tutorial in source markdown.
- Capture screenshots on current build.
- Record short GIFs for key multi-step interactions.

### 3.3 Technical review (Thursday)
- Verify steps against current UI/API.
- Verify claims against docs and security policy.
- Verify endpoint paths align with current schema.

### 3.4 Editorial review (Thursday)
- Ensure tone consistency and mission alignment.
- Apply claim-safety checks (avoid unsupported absolutes).

### 3.5 Publish and monitor (Friday)
- Publish tutorial updates.
- Add to changelog/tutorial index.
- Track user feedback and correction requests.

## 4. Tutorial Quality Checklist

Required before publish:
- Steps execute exactly as written.
- Screenshots match current UI labels.
- API examples use current /api/v1 paths and auth model.
- Security statements use approved wording.
- Last-verified date is present.

## 5. Asset Standards

Screenshots:
- 1440px desktop baseline where possible.
- Crop to relevant area; avoid sensitive data.
- Filename convention: tutorial-topic-step-YYMMDD.png

GIFs:
- 6 to 20 seconds.
- Keep file size low for docs performance.
- Highlight one workflow per GIF.

## 6. Ownership Model

Roles:
- Author: writes and captures assets.
- Technical reviewer: validates factual correctness.
- Editorial reviewer: clarity and tone.
- Publisher: merges and announces.

No tutorial publishes without at least one technical reviewer.

## 7. Trigger-Based Updates

Mandatory update triggers:
- UI label or navigation changes.
- Endpoint/auth changes.
- Security policy wording changes.
- New major feature affecting existing tutorial steps.

## 8. 8-Week Initial Content Backlog

Suggested sequence:
1. First study in 15 minutes
2. Publish and participant link workflows
3. Stroop and N-back advanced setup
4. Export to R pipeline
5. API automation basics
6. MFA and protected decrypt workflows
7. Credits/CRediT contribution workflow
8. Prolific or JATOS integration guide

## 9. Website Integration Note

When contact form wiring is implemented, add tutorial request intake fields for:
- tutorial topic request
- institution/lab context
- urgency level
- optional collaboration proposal
