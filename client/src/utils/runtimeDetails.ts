/**
 * Runtime paths belong to the execution environment, not to the user's
 * deliverable. This is deliberately applied only to assistant-authored
 * content: user-provided paths must remain intact when a user is asking for
 * help with a path of their own.
 */
const INTERNAL_RUNTIME_PATH = /(?:sandbox:)?\/(?:mnt\/data|app\/cache|tmp\/(?:code|sandbox)|workspace)(?:\/[\w@.+~%=-]+)*/gi;

export function redactInternalRuntimeDetails(content: string): string {
  return content.replace(INTERNAL_RUNTIME_PATH, 'file hasil');
}
