# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Getting set up

```bash
npm install
npm run check   # type-check
npm test        # unit tests: no network, no browser, no credentials
npm run build
```

Node 20 or newer. The test suite must stay offline and must never open a
browser or read the developer's keychain — `test/server.test.ts` shows the
helpers (`withCredentials`, `withoutCredentials`) that keep it that way.

## Checking against a real account

```bash
node scripts/smoke.mjs           # read-only: auth, documents, elements
node scripts/smoke.mjs --write   # builds a throwaway part in a new document
```

The write path creates a document in your Onshape account and tries to delete it
afterwards. Deletion needs an API key with Delete permission, so check your
account for leftovers if it fails.

## House style

- Lengths are inches and angles degrees at every boundary; convert once, at the
  payload builders.
- Prefer FeatureScript queries over deterministic ids when selecting geometry —
  queries survive topology changes.
- Onshape answers `200` for features that fail to regenerate. Anything that adds
  a feature must verify the feature state afterwards.
- Explain *why* in comments where the Onshape API is surprising; the code
  already says what it does.
- New tools go in the matching `src/tools/*.ts` module, are spread into
  `allTools`, and need a description a model can act on. A test enforces the
  registration.

## Adding a tool

1. Add the REST call to `src/api/` if it isn't there.
2. Add any feature payload to `src/builders/`, with a unit test for its shape.
3. Add the tool to the right `src/tools/*.ts` module.
4. Update the tool table in `README.md`.

## Releasing

Maintainers only: bump the version in `package.json` and `server.json`, update
`CHANGELOG.md`, then push a matching tag (`v0.2.0`). CI publishes to npm with
provenance, publishes to the MCP registry and attaches the Desktop bundle to the
GitHub release.
