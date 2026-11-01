// Trust root for the Windows/Linux auto-update channel manifest.
//
// The matching private key lives only in the NEXUS_UPDATE_SIGNING_KEY GitHub
// Actions secret and is never committed. Rotating the key requires a release
// that embeds the new public key before any manifest is signed with it, so
// older clients keep refusing manifests they cannot verify.

/**
 * Ed25519 SPKI public key used to verify `<manifest>.sig` files.
 * Empty/placeholder values must never be substituted here: verification fails
 * closed when this key is not a usable Ed25519 public key.
 */
export const UPDATE_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMgtx3YDuBlFTDZeghX/XptItmIkPR5ZAv7Z6mkrNXds=
-----END PUBLIC KEY-----`
