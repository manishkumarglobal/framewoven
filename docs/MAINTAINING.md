# Maintaining Framewoven

This document describes how Framewoven is developed, reviewed, and released.

## Canonical repository

The canonical repository is https://github.com/manishkumarglobal/framewoven.
All development, Issues, pull requests, and releases happen there.

A clone needs only one remote:

```bash
git remote -v
# origin  https://github.com/manishkumarglobal/framewoven.git (fetch)
# origin  https://github.com/manishkumarglobal/framewoven.git (push)
```

Framewoven does not keep an `upstream` remote and does not routinely synchronize with any other repository.
Where the code came from is recorded in [`PROVENANCE.md`](./PROVENANCE.md), not in remote configuration.

## No ticket, no work

Every material product or engineering change starts as a GitHub Issue and lands through a pull request that references it, normally with `Closes #N`.
Trivial administrative edits, such as a typo or a one-line ignore rule, do not need an Issue.

## Branches

Work happens on a short-lived branch cut from `main`, named `<type>/<short-description>`.
The types follow the commit prefixes already used in the history: `feat`, `fix`, `docs`, `test`, `chore`.
For example: `fix/export-timeout`, `docs/install-steps`, `chore/release-v0.1.4`.

`main` is protected.
It cannot be deleted or force-pushed, and it changes only through a pull request whose CI check has passed.

## Pull requests

1. Open the pull request against `main` and reference its Issue with `Closes #N`.
2. Describe what changed, why, how it was verified, and what is explicitly out of scope.
3. Wait for the `typecheck / lint / test / build` check to pass.
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
Planned capabilities are listed in the README and tracked as Issues, and they are described as shipped only after they are released.
