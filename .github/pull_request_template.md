## What this changes

<!-- The behavior difference, in a sentence or two. -->

## Why

<!--
The problem it solves. If it fixes a bug, what was the observable symptom?
If it adds something, what could you not do before?
Link an issue if there is one.
-->

## How it was verified

<!--
For a bug fix: the test that failed before and passes now.
For a feature: what you ran, and what you checked in the output.
"Tests pass" is not verification — CI already says that.
-->

## Checklist

- [ ] `bun run test:gate` passes locally
- [ ] New behavior has a test; a bug fix has a test that failed before the fix
- [ ] Documentation updated if the change affects it
- [ ] `CHANGELOG.md` Unreleased section updated for anything user-visible

<!--
If your change touches one of the design decisions in
CONTRIBUTING.md#architecture-constraints — engine-vs-skill split, screen's
statelessness, missing secondary sources, filing's lack of stale fallback,
paths as getters — please say why the constraint should change. They look like
omissions and are not.
-->
