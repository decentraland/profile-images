import { test } from '../components'

test('tools endpoint', function ({ components, stubComponents }) {
  it('responds /tools', async () => {
    const { localFetch, producer } = components

    const r = await localFetch.fetch('/tools', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify({ lastRun: 1234 })
    })
    expect(r.status).toEqual(204)
    expect(producer.changeLastRun).toHaveBeenCalledWith(1234)
  })

  it('responds /tools without changing lastRun', async () => {
    const { localFetch, producer } = components

    const r = await localFetch.fetch('/tools', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify({})
    })
    expect(r.status).toEqual(204)
    expect(producer.changeLastRun).not.toHaveBeenCalledWith()
  })

  it('rejects /tools without auth token', async () => {
    const { localFetch, producer } = components

    const r = await localFetch.fetch('/tools', {
      method: 'POST',
      body: JSON.stringify({})
    })
    expect(r.status).toEqual(401)
    expect(producer.changeLastRun).not.toHaveBeenCalled()
  })
})
