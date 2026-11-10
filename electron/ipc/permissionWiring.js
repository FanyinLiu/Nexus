// @ts-check
/**
 * Wire the one permission lifecycle into every IPC consumer. Keeping this in
 * one helper makes it impossible for one handler to receive a different
 * lifecycle instance (and therefore a different baseline/edge state).
 */

/**
 * @param {{
 *   mediaPermissionLifecycle: object,
 *   voiceSidecarSupervisor?: object,
 *   voiceRuntimeIpc: { register: (options: object) => void },
 *   externalActionPolicyIpc: { register: (options: object) => void },
 *   mediaPermissionIpc: { register: (options: object) => void },
 * }} deps
 */
export function registerPermissionConsumers({
  mediaPermissionLifecycle,
  voiceSidecarSupervisor,
  voiceRuntimeIpc,
  externalActionPolicyIpc,
  mediaPermissionIpc,
}) {
  externalActionPolicyIpc.register({ mediaPermissionLifecycle })
  voiceRuntimeIpc.register({ voiceSidecarSupervisor, mediaPermissionLifecycle })
  mediaPermissionIpc.register({ mediaPermissionLifecycle })
}
