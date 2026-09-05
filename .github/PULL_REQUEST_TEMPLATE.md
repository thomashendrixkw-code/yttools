## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem being solved, not a restatement of the diff. -->

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `npm run check` passes (typecheck + lint + tests)
- [ ] `npm run build` passes
- [ ] Tried by hand against a Creative Commons or public-domain video
- [ ] Tested the failure path, not just the happy path

## Checklist

- [ ] No user input is interpolated into a shell string
- [ ] Any new request field is validated in `src/lib/validate.ts`
- [ ] Any new path out of `/api/download` still deletes its scratch directory
- [ ] Tests added for new logic in `src/lib/`
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
