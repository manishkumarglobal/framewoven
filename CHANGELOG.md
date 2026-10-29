# Changelog

All notable changes to Framewoven are documented here.

Framewoven is derived from [Open Carrusel](https://github.com/Hainrixz/open-carrusel) through a maintained fork, [manishkumarglobal/open-carrusel](https://github.com/manishkumarglobal/open-carrusel).
Versions 0.1.1 and 0.1.2 below were released from that fork, and their links point to it.
This changelog does not restate the original project's history; see [`docs/PROVENANCE.md`](./docs/PROVENANCE.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- LinkedIn PDF export.
  The editor's Export button is now a menu with two choices: **Instagram · PNG ZIP**, the existing download of one PNG per slide, and **LinkedIn · PDF**, one multi-page PDF for a LinkedIn document post.
  The PDF is built from the same rendered PNGs, one slide per page in carousel order, embedded losslessly, so it shows exactly what the PNG export shows.
  Every page has the carousel's own aspect ratio: 4:5, the recommended LinkedIn format, gives 4:5 portrait pages; 1:1 gives square pages; and 9:16 exports as-is, with a note in the menu that 4:5 generally displays better in LinkedIn's feed.
  A PDF above LinkedIn's 100 MB limit is refused with a message saying what to change.
- `POST /api/carousels/[id]/export?format=pdf` returns that PDF.
  A request without `format`, or with `format=png`, still returns the ZIP of PNGs, and an unknown format is rejected with status 400.
- Direct PNG download for single-slide carousels (#21).
  When a carousel has exactly one slide, such as a reel cover, the Export menu also offers **Instagram · PNG**, which downloads that slide as an ordinary `.png` file with no ZIP to extract.
  It is the same image, byte for byte, that the PNG ZIP contains, in every aspect ratio.
  `POST /api/carousels/[id]/export?format=single-png` returns it, and refuses a carousel with more than one slide with status 400.

### Fixed

- Export is no longer offered while the design agent is still creating or changing slides (#20).
  Exporting during that window could download a half-finished carousel.
  The Export button now reads **Waiting for slides…** until the agent's run has ended, whether it finished, failed or was stopped, and this holds after a page reload or in a second tab.
  The export API refuses such a carousel with status 409 and a message saying why, and `GET /api/carousels/[id]/generation` reports whether a run is still in progress.
  Carousels that are not being generated export exactly as before.

## [0.1.3] - 2026-10-27

The first standalone Framewoven release.
Framewoven is now an independently maintained product with its own repository, identity, documentation, and release process.
This release contains no new functional features.
Apart from the product name, the application, its storage format, its API, and its rendering and export pipeline are unchanged from 0.1.2, and existing local data in `data/` and `public/uploads/` is used as is.

### Changed

- The product is now Framewoven, an independently maintained project with its own repository at https://github.com/manishkumarglobal/framewoven.
  The page title, dashboard heading, editor header, chat assistant label, setup messages, Claude Code slash commands, and the design agent's prompt use the new name.
  The design agent's Claude Code sessions are now named `framewoven-chat` instead of `carrusel-chat`.
  Package metadata and every repository link point to the new repository.
- `/start` now recognizes an already-running instance by the Framewoven name, and the background dev server logs to `/tmp/framewoven-dev.log` (`framewoven-dev.log` in the temp directory on Windows) instead of `open-carrusel-dev.log`.
- The README is rewritten around what the app does today, with tested install steps, a clear split between application source and your data, and a separate list of planned capabilities.
  Statements that overstated the previous behavior are corrected: chat replies arrive one message at a time, exports are downloaded rather than stored, and slide content cannot be created without the Claude CLI.
- The maintainer guide is now `docs/MAINTAINING.md` and describes independent maintenance.
  Framewoven no longer keeps an `upstream` remote or synchronizes with the original project; outside changes are adopted only through a reviewed Issue and pull request.

### Added

- `docs/PROVENANCE.md` records the original project, the maintained fork, the exact source baseline, the MIT license and its copyright notice, attribution, and where the fork's Issues, pull requests, and releases remain.

## [0.1.2] - 2026-09-02

A narrowly scoped contract-hardening pass: the API stops accepting fields it
never defined as mutable, and the assistant-facing documentation is brought back
into line with the code.

### Security

- Update endpoints no longer merge an arbitrary request body onto the stored
  entity. `PUT /api/carousels/[id]`, `PUT /api/carousels/[id]/slides/[slideId]`
  and `PUT /api/brand` now select only the fields each endpoint defines as
  mutable. A caller could previously replace a carousel's `id`, delete every
  slide by sending `slides: []`, rewrite `createdAt`, set `isTemplate` so the
  carousel disappeared from the dashboard while staying on disk, empty a slide's
  `previousVersions` undo history, and persist unknown keys. The library
  functions declared narrow contracts, but TypeScript types are erased at
  runtime and nothing enforced them against a real caller.

### Fixed

- `CLAUDE.md` no longer contradicts the product it describes. It stated a
  maximum of 10 slides where the code enforces 20, listed the design agent's
  granted tools as `Bash WebFetch` when the chat route also grants `Read`, and
  described the upload route as images-only when it also accepts WOFF2 and TTF
  fonts. The slide limit mattered most: the agent is handed both that file and a
  system prompt that interpolates the real limit, so it was reading two
  different numbers. `README.md` repeated the same stale tool list. A test now
  pins these statements to the code so they cannot drift again.
- `aspectRatio` is validated on update as well as on create. `PUT` previously
  accepted any string, and an unsupported value has no entry in `DIMENSIONS`,
  which the preview iframe, the export viewport and the safe-zone overlay all
  read.

## [0.1.1] - 2026-09-02

The first release of this maintained fork. Everything here is a backward-
compatible fix or an additive change on top of the upstream 0.1.0 baseline.

### Added

- Fork provenance documentation: an `About this fork` notice in the README and a
  maintainer guide covering the upstream sync model.
- A test harness (Vitest) and a continuous integration workflow running
  typecheck, lint, tests, and a production build on every pull request.
- `GET /api/chat/check` now also reports `baseUrl`, the origin the design agent
  will be told to call, so a port mismatch is visible without starting a chat.

### Fixed

- A failed export now says what went wrong and what to do about it, in the
  editor. Failures previously went only to the browser console, so a broken
  Chromium install looked like a spinner that quietly gave up. The message is a
  classified summary; the underlying error, including paths and stack traces,
  stays in the server log.
- The export button no longer shows a slide counter frozen at zero. It read from
  a progress stream the export route never produced, so the count could not
  move. It reports an honest indeterminate state instead.
- The safe-zone overlay lines up with the slide. It was positioned against the
  preview container rather than the letterboxed slide inside it, so its guides
  ran past the slide edges by 62% of the slide's width at 1:1 and 188% at 9:16.
  Content the overlay called safe could sit outside the slide entirely.
- The design agent is told the origin the app is actually running on instead of a
  hardcoded `http://localhost:3000`. Running on any other port, which `/start
  [port]` and `PORT` both support, previously sent the agent's slide writes to
  whatever else was listening on 3000, or to nothing at all.
- Brand fonts now actually render. Font-family extraction failed on the exact
  form the system prompt teaches the AI to write, `font-family: 'Name', serif`,
  because the captured value was not allowed to contain quote characters. Every
  generated slide therefore rendered in a system fallback in both preview and
  export, and because both failed identically there was nothing to notice.
  Quoted and unquoted names, with and without fallbacks, in inline styles and in
  style blocks, are all handled now.
- Italic text uses the font's real italic design instead of a browser-synthesised
  slant. The italic cut is requested separately per family, because Google
  rejects the italic axis outright for families that have none, and a rejected
  family in a combined request took every other family down with it.
- Export no longer stalls. It waited for every declared font face to report
  loaded, which never happens: only the faces a slide uses are ever loaded, so
  the wait ran to its full 10 second timeout on every slide. It now waits for
  font loading to settle, which is bounded and correct.
- Export waits for images explicitly. Images previously arrived in time only as
  a side effect of the font stall above, so removing the stall would have raced.
- Font cache filenames are derived from sanitised family names. Names come from
  AI-authored slide HTML and were previously interpolated into a path unescaped.
- Concurrent changes to a data file are no longer lost. The per-file lock now
  covers the whole read, modify and write, so overlapping requests can no longer
  read the same snapshot and have the later write discard the earlier one while
  both report success. Previously, 12 slides created at once persisted 1.
- A data file that exists but no longer parses is reported as an explicit error
  and left on disk untouched, instead of being treated as an absent file and
  overwritten with empty defaults on the next write. Defaults now apply only when
  a file is genuinely missing.
- Storage failures are no longer reported to the user as a malformed request, and
  a failed load no longer renders as an empty account. The dashboard and the
  editor show what went wrong and state that nothing was deleted.
- Reordering slides now requires a full permutation of the carousel's slides.
  A partial list previously discarded every slide left out of it, and a list
  containing the same slide twice duplicated it.
- Slide preview no longer reads a React ref during render to decide its
  transition direction. The previous index is tracked in state instead, which
  removes a `react-hooks/refs` violation that made the newly added lint gate
  unpassable and could have produced a stale transition direction.

[Unreleased]: https://github.com/manishkumarglobal/framewoven/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/manishkumarglobal/framewoven/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/manishkumarglobal/open-carrusel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/manishkumarglobal/open-carrusel/releases/tag/v0.1.1
