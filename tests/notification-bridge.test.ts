import assert from 'node:assert/strict'
import { test } from 'node:test'

function resolveChannelsLoad(
  desktopPet: { getNotificationChannels?: (() => Promise<unknown[]>) | undefined } | undefined,
) {
  const getNotificationChannels = desktopPet?.getNotificationChannels
  if (!getNotificationChannels) {
    return Promise.resolve({
      channels: [],
      loading: false,
    })
  }

  return getNotificationChannels()
    .then((chs) => ({
      channels: chs ?? [],
      loading: false,
    }))
    .catch(() => ({
      channels: [],
      loading: false,
    }))
}

test('notification bridge loading settles immediately when desktop api is unavailable', async () => {
  const result = await resolveChannelsLoad(undefined)

  assert.deepEqual(result, {
    channels: [],
    loading: false,
  })
})
