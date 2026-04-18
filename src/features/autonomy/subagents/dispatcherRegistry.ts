/**
 * Module-level pointer to the live `SubagentDispatcher` instance.
 *
 * The dispatcher is created inside the React tree (useAutonomyV2Engine) so it
 * can observe settings, runtime events, and the persistence store. The chat
 * tool-call loop — which lives outside React and gets called on every LLM
 * tool response — needs a way to reach it without prop drilling. The mount
 * effect in useAutonomyV2Engine sets this slot; the chat-side
 * `spawn_subagent` tool reads it.
 *
 * Singleton pattern is fine here because there is only ever one autonomy
 * engine instance per app session. If that ever changes, the registry would
 * need to become a keyed map.
 */

import type { SubagentDispatcher } from './subagentDispatcher.ts'

let registered: SubagentDispatcher | null = null

export function registerSubagentDispatcher(dispatcher: SubagentDispatcher | null): void {
  registered = dispatcher
}

export function getRegisteredSubagentDispatcher(): SubagentDispatcher | null {
  return registered
}
