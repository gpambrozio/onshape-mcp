# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub security advisories](https://github.com/gpambrozio/onshape-mcp/security/advisories/new)
rather than a public issue. I aim to respond within a week.

## How credentials are handled

- Onshape credentials are stored in the OS keychain when one is available
  (service `onshape-mcp`), otherwise in `~/.onshape-mcp/credentials.json`,
  written `0600` inside a `0700` directory.
- They are sent only to the configured Onshape host. The `Authorization` header
  is withheld from redirects that leave the Onshape domain, because Onshape
  hands out presigned S3 URLs that need no credentials.
- Secrets are never written to the transcript: `onshape_auth_status` and the
  stored-config summary redact them.
- The sign-in page is served on `127.0.0.1`, requires a single-use nonce, and
  refuses requests that did not address the loopback interface, which blocks
  DNS-rebinding from a page in the user's browser.
- Credentials are never sent to the MCP client or the model. This is why sign-in
  uses MCP's URL-mode elicitation: the client only ever sees a link.
- No telemetry of any kind.

## What this server can do

It is a local process acting with your Onshape permissions: it can create,
modify and delete documents in your account. The `onshape_delete_document` and
`onshape_delete_element` tools are marked destructive so clients can prompt.
Consider using an API key without delete permission if you want a hard limit.
