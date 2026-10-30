# Maintaining Framewoven

This document describes how Framewoven is developed, reviewed, and released.

## Canonical repository

The canonical repository is https://github.com/mk-global/framewoven.
All development, Issues, pull requests, and releases happen there.

A clone needs only one remote:

```bash
git remote -v
# origin  https://github.com/mk-global/framewoven.git (fetch)
# origin  https://github.com/mk-global/framewoven.git (push)
```

Framewoven does not keep an `upstream` remote and does not routinely synchronize with any other repository.
Where the code came from is recorded in [`PROVENANCE.md`](./PROVENANCE.md), not in remote configuration.

## No ticket, no work

Every material product or engineering change starts as a GitHub Issue and lands through a pull request that references it, normally with `Closes #N`.
Every change that reaches a protected PR must close at least one OPEN, admitted issue. Do not exempt documentation or administrative changes from the reviewer scope gate.

## Ticket and PR admission — public repository

Framewoven is an explicit public-repository exception in EngineeringToolsMK's `tools/repo-onboarding/inventory.json` (decision #234). CI uses GitHub-hosted runners. **Do not** add private self-hosted governance workflows, admit this repository to the private runner group, or run ordinary `onboard.py onboard/verify` against it. EngineeringToolsMK's organisation `onboard.py audit` verifies this exception.

The canonical policy lives in private `mk-global/EngineeringToolsMK/tools/github-policy/validate.py` (`github-policy/v2.0.0`). Every linked engineering issue must be OPEN and contain non-empty Markdown sections with exactly these headings:

- `Problem`
- `Desired Outcome`
- `Scope`
- `Out of Scope`
- `Acceptance Criteria` (at least one Markdown list item)
- `Verification`
- `Dependencies / Blockers`
- `Risks / Constraints`

Every PR description must contain `GitHub Issue` (with `Closes #N`), `Objective`, `Scope`, `Acceptance Criteria` (list item required), `Verification Evidence`, `Risk Assessment`, `Rollback`, and `Decisions / Deviations`. The templates under `.github/` provide **advisory** scaffolds; replace the HTML-comment instructions with actual content. GitHub API and cloud agents can bypass templates.

Before publishing tickets or PRs, run the **canonical installed** validator (do not copy its rules into this repo):

```bash
# Run from the EngineeringToolsMK checkout, with GitHub access:
gh issue view N --repo mk-global/framewoven --json body --jq .body | python3 tools/github-policy/validate.py ticket -
gh issue view N --repo mk-global/framewoven --json state,body | python3 tools/github-policy/validate.py linked-ticket -
gh pr view N --repo mk-global/framewoven --json body --jq .body | python3 tools/github-policy/validate.py pr -
```

For draft bodies not yet published, save the proposed Markdown to a temporary file and run `python3 tools/github-policy/validate.py ticket /path/to/draft.md` (or `pr` for a PR). Check **every** linked issue before opening a PR. These commands are author-side checks, not hard enforcement.

**Actual merge enforcement:** the independent reviewer checks open linked tickets against the canonical policy (`scope: required`), and branch protection requires `local-ai/pr-review/main` pinned to reviewer GitHub App 4577329 with strict freshness. An invalid ticket can cause the reviewer to skip a PR **without publishing any status**. If the reviewer check is absent, validate the linked issues first; then check review queue/service if the issues are valid. Do not invoke manual rereviews as a substitute for ticket admission.

Creation pathways differ: GitHub web UI uses the advisory templates; browser/cloud Claude or API clients must validate explicitly; local `mk-agent` uses the approved `mk-github` broker and should also validate before publication. Enforcement at client write-time and an explanatory non-authoritative reviewer status are tracked under Framewoven #24 and require separate reviewed EngineeringToolsMK changes. They are **not** yet active, and this documentation does not implement them.

## Branches

Work happens on a short-lived branch cut from `main`, named `<type>/<short-description>`.
The types match the conventional commit prefixes: `feat`, `fix`, `docs`, `test`, `chore`.
For example: `fix/export-timeout`, `docs/install-steps`, `chore/release-v0.1.4`.

`main` is protected.
It cannot be deleted or force-pushed, and it changes only through a pull request whose CI check has passed.

## Pull requests

1. Open the pull request against `main` and reference its Issue with `Closes #N`.
2. Use the canonical PR template. Describe objective, scope, acceptance criteria, verification evidence, risks, rollback, and decisions/deviations. The `GitHub Issue` section must include a closing reference.
3. Wait for `typecheck / lint / test / build` and `local-ai/pr-review/main` from the pinned independent reviewer App to pass.
4. Review the complete diff before merging, including documentation and tests.
5. Squash-merge with a conventional title, which becomes the commit subject on `main`, for example `fix: surface export failures (#12)`.

## Tests

Run the full gate before opening a pull request:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

CI runs the same four steps on every pull request and on every push to `main`.

Every behavior change needs automated coverage proportional to its risk.
Every bug fix needs a regression test that fails on the old behavior and passes after the fix.
Do not disable or weaken existing tests to make a change pass.

## Changelog

Every pull request that changes behavior adds an entry under `[Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md), following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Write entries for the people who use Framewoven: what changed for them and why it matters.

## Releases

Framewoven uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and continues the version line inherited from the maintained fork.
Historical tags are never moved or deleted.

1. Open an Issue for the release and a `chore/release-vX.Y.Z` branch.
2. Move the applicable `[Unreleased]` entries into a dated `[X.Y.Z]` section and update the comparison links at the bottom of the changelog.
3. Bump the version with `npm version X.Y.Z --no-git-tag-version`, which updates `package.json` and `package-lock.json` together.
4. Merge the release pull request once CI passes.
5. Create an annotated tag on the merge commit and push it:

   ```bash
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z - <summary>"
   git push origin vX.Y.Z
   ```

6. Publish GitHub release notes derived from the changelog section:

   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z - <summary>" --notes-file <notes.md> --verify-tag
   ```

## Source provenance

`LICENSE` and its copyright notice are carried over from the original project and must not be removed or altered.
[`PROVENANCE.md`](./PROVENANCE.md) is the record of where the code came from and must stay accurate.

Changes from the original Open Carrusel project, or from any other source, are never imported automatically.
If one is worth considering, open an Issue that links the specific change, review it on its own merits including any license or notice implications, and adopt it through a normal pull request.
Record anything adopted this way in the changelog and, where it affects origin or attribution, in `PROVENANCE.md`.

## Roadmap

Framewoven owns its roadmap.
Planned capabilities are listed in the README and get a tracked Issue when work on them is scheduled.
They are described as shipped only after they are released.
