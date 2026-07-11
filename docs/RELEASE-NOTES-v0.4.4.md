# Nexus v0.4.4 — Beta Feedback And Copy Tuning

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

v0.4.4 keeps the 0.4 line in draft review after the stable v0.4.0 quiet
observation foundation and the stacked v0.4.1, v0.4.2, and v0.4.3 follow-ups.
This slice does not add new sensing, new notifications, generated copy, or pet
behavior. It makes beta feedback safer to compare and makes check-in copy
harder to accidentally turn into monitoring language.

## What Changed

- Kept beta feedback collection in the structured issue template rather than
  shipping an in-app normalization or storage helper.
- Added structured v0.4 fields to the beta validation issue template.
- Added five-locale copy guardrails for every desktop companion check-in
  reason.
- Added a fixed safe fallback line so an unsafe future copy edit cannot silently
  remove the in-app check-in.
- Nexus does not retain an in-app feedback payload containing raw comments,
  timestamps, window titles, clipboard bodies, screenshots, file paths, user
  IDs, or session traces; issue submissions remain user-controlled.
- Feedback labels are not used for training, personalization, scoring, adaptive
  behavior, or persistent analytics.

## Not Included

- No formal v0.4.4 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- No feedback analytics engine, adaptive copy system, A/B testing, external
  notifications, message sending, tool execution, productivity score, new
  sensing source, pet movement, or desktop window control.
