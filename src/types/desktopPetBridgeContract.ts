/**
 * Compile-time contract between the hand-written `Window.desktopPet` type and
 * the bridge surface generated from electron/preload.js.
 *
 * The generated key union catches drift in either direction. Panel-only members
 * are exposed through a conditional spread and must stay optional in the
 * hand-written type; the reverse is not required because some always-present
 * members are intentionally optional for older preload builds.
 */

import type {
  DesktopPetBridgeKey,
  DesktopPetConditionalBridgeKey,
} from './generated/desktopPetBridge.generated.ts'

type Expect<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

type DesktopPetBridge = NonNullable<Window['desktopPet']>

type OptionalDesktopPetBridgeKey = {
  [Key in keyof DesktopPetBridge]-?: undefined extends DesktopPetBridge[Key] ? Key : never
}[keyof DesktopPetBridge]

type BridgeKeysEqualGeneratedKeys = Expect<Equal<keyof DesktopPetBridge, DesktopPetBridgeKey>>
type ConditionalKeysAreOptional = Expect<
  Equal<Exclude<DesktopPetConditionalBridgeKey, OptionalDesktopPetBridgeKey>, never>
>

export type DesktopPetBridgeContract = [
  BridgeKeysEqualGeneratedKeys,
  ConditionalKeysAreOptional,
]
