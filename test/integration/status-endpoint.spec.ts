import { test } from '../components'

test('status endpoint', function ({ components }) {
  it('responds /status', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/status')
    expect(r.status).toBe(200)
  })
})
