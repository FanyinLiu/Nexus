function parseExternalLinkInput(rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!trimmed) return null
  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    return new URL(normalized)
  } catch {
    return null
  }
}

function summarizeUrlShape(rawUrl) {
  const inputLength = typeof rawUrl === 'string' ? rawUrl.length : 0
  const parsed = parseExternalLinkInput(rawUrl)

  if (!parsed) {
    return {
      inputLength,
      parsed: false,
    }
  }

  return {
    inputLength,
    parsed: true,
    protocol: parsed.protocol.replace(/:$/, ''),
    hostnamePresent: Boolean(parsed.hostname),
    hostnameLength: parsed.hostname.length,
    pathnameLength: parsed.pathname.length,
    searchPresent: Boolean(parsed.search),
    searchLength: parsed.search.length,
    hashPresent: Boolean(parsed.hash),
    hashLength: parsed.hash.length,
  }
}

export function summarizeExternalLinkRequest(payload = {}) {
  const policy = payload?.policy && typeof payload.policy === 'object' ? payload.policy : {}
  return {
    channel: 'tool:open-external',
    url: summarizeUrlShape(payload?.url),
    policy: {
      enabled: policy.enabled !== false,
      requiresConfirmation: policy.requiresConfirmation === true,
    },
  }
}

export function summarizeExternalLinkResult(result = {}, error = null) {
  const summary = {
    channel: 'tool:open-external',
    ok: !error,
    resultKind: error
      ? 'error'
      : Array.isArray(result)
        ? 'array'
        : result === null
          ? 'null'
          : typeof result,
    urlLength: typeof result?.url === 'string' ? result.url.length : undefined,
    messageLength: typeof result?.message === 'string' ? result.message.length : undefined,
    errorName: error?.name,
    errorMessageLength: error?.message ? String(error.message).length : 0,
  }

  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined))
}
