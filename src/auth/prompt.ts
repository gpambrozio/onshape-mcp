/** Asking the user to authorize, through the MCP client rather than through the
 *  model's prose.
 *
 * The MCP spec's URL-mode elicitation exists for precisely this case: the client
 * shows the user a link and the sensitive exchange happens out of band, never
 * passing through the client or the model. Clients that do not support it fall
 * back to the URL being reported in the tool result. */

export type PromptOutcome = "accept" | "decline" | "cancel" | "unsupported";

export interface AuthPrompter {
  /** True when the connected client can show a URL elicitation. */
  canPrompt(): boolean;
  /** Ask the user to open `url`. Resolves once the client has shown it. */
  prompt(params: { message: string; url: string; elicitationId: string }): Promise<PromptOutcome>;
  /** Tell the client the out-of-band interaction has finished, so it can
   *  dismiss its prompt. */
  complete(elicitationId: string): Promise<void>;
}

/** Used when no client is attached (tests, the smoke script). */
export const noPrompter: AuthPrompter = {
  canPrompt: () => false,
  prompt: async () => "unsupported",
  complete: async () => {},
};
