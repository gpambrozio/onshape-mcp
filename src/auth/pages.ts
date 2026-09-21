/** The two pages the local login server serves. Plain HTML, no assets, no CDN:
 *  the browser must render them offline on 127.0.0.1. */

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; background: #f6f7f9; color: #14181f; }
  @media (prefers-color-scheme: dark) { body { background: #14181f; color: #e8eaed; }
    .card { background: #1d222b !important; border-color: #2c333f !important; }
    input { background: #14181f !important; color: #e8eaed !important; border-color: #2c333f !important; } }
  .card { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px; padding: 28px 32px;
          width: 420px; box-shadow: 0 6px 24px rgba(0,0,0,.06); }
  h1 { font-size: 19px; margin: 0 0 6px; }
  p { margin: 0 0 16px; color: #5a6472; }
  ol { margin: 0 0 18px; padding-left: 20px; color: #5a6472; }
  a { color: #0b6bcb; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d3d8e0;
          border-radius: 7px; font-size: 14px; font-family: ui-monospace, SFMono-Regular, monospace; }
  button { margin-top: 20px; width: 100%; padding: 10px; border: 0; border-radius: 7px;
           background: #0b6bcb; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:hover { background: #0a5cb0; }
  .error { background: #fdecec; border: 1px solid #f5c2c2; color: #a02020; padding: 10px 12px;
           border-radius: 7px; font-size: 13px; margin-bottom: 4px; }
  .ok { font-size: 44px; text-align: center; margin-bottom: 8px; }
  .go { display: block; margin: 0 0 18px; padding: 10px; border-radius: 7px; background: #0b6bcb;
        color: #fff; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; }
  .go:hover { background: #0a5cb0; }
  .hint { font-size: 12px; color: #78828f; margin: 5px 0 0; }
`;

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main class="card">${inner}</main></body></html>`;
}

export function apiKeyForm(opts: { nonce: string; baseUrl: string; keysUrl: string; error?: string }): string {
  const error = opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : "";
  return shell(
    "Connect Onshape",
    `<h1>Connect Onshape</h1>
     <p>This page is served locally by the Onshape MCP server. Your keys go straight into your
        OS keychain and are never sent anywhere else.</p>
     <a class="go" id="key_page" href="${escapeHtml(opts.keysUrl)}" target="_blank" rel="noreferrer">
       Create an API key on Onshape &nearr;</a>
     <ol>
       <li>Tick <strong>Read</strong>, <strong>Write</strong> and <strong>Delete</strong> so every tool
           here works, then create the key.</li>
       <li>Copy both halves before closing the Onshape tab &mdash; the secret is shown only once.</li>
       <li>Paste them below and save.</li>
     </ol>
     ${error}
     <form method="post" action="/submit">
       <input type="hidden" name="nonce" value="${escapeHtml(opts.nonce)}">
       <label for="access_key">Access key</label>
       <input id="access_key" name="access_key" autocomplete="off" spellcheck="false" autofocus required>
       <label for="secret_key">Secret key</label>
       <input id="secret_key" name="secret_key" autocomplete="off" spellcheck="false" required>
       <label for="base_url">Onshape URL</label>
       <input id="base_url" name="base_url" value="${escapeHtml(opts.baseUrl)}" spellcheck="false">
       <p class="hint">On an enterprise stack, set this first &mdash; the key link above follows it.</p>
       <button type="submit">Verify and save</button>
     </form>
     <script>${KEY_LINK_SCRIPT}</script>`,
  );
}

/** Enterprise accounts keep their keys on their own host, and the user may only
 *  realise that once they are looking at this page. */
const KEY_LINK_SCRIPT = `
  var field = document.getElementById("base_url");
  var link = document.getElementById("key_page");
  field.addEventListener("input", function () {
    try {
      link.href = "https://" + new URL(field.value.trim()).hostname + "/user/developer/apiKeys";
    } catch (e) {
      // Half-typed URL: keep the last link that parsed.
    }
  });
`;

export function successPage(message: string): string {
  return shell(
    "Onshape connected",
    `<div class="ok">&#10003;</div><h1 style="text-align:center">Onshape connected</h1>
     <p style="text-align:center">${escapeHtml(message)}</p>
     <p style="text-align:center">You can close this tab and go back to your assistant.</p>`,
  );
}

export function errorPage(message: string): string {
  return shell(
    "Onshape login failed",
    `<h1>Login failed</h1><div class="error">${escapeHtml(message)}</div>
     <p style="margin-top:16px">Run the login tool again to retry.</p>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
