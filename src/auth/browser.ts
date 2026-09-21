/** Opening the user's browser is a convenience, never a requirement: every
 *  caller also reports the URL, and headless machines simply fail quietly.
 *  Set ONSHAPE_MCP_NO_BROWSER=1 to keep this process from launching anything. */
export async function openBrowser(url: string): Promise<boolean> {
  if (isTruthy(process.env.ONSHAPE_MCP_NO_BROWSER)) return false;
  try {
    const { default: open } = await import("open");
    await open(url);
    return true;
  } catch {
    return false;
  }
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}
