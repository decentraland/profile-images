import { test } from '../components'

test('set-schedule-processing endpoint', function ({ components, stubComponents }) {
  it.skip('responds /schedule-processing', async () => {
    const { localFetch } = components
    const { fetch, producer, sqsClient, storage } = stubComponents

    // fetch.fetch.mockResolvedValueOnce(
    //   new Response(
    //     JSON.stringify({
    //       id: 'abcd'
    //     })
    //   )
    // )

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        ContentType: 'application/json'
      },
      body: JSON.stringify(['abcd'])
    })
    expect(r.status).toBe(204)
    expect(producer.changeLastRun).toHaveBeenCalledWith(1234)
  })

  it.skip('responds /schedule-processing without proper body', async () => {
    const { localFetch } = components
    const { fetch, sqsClient, storage } = stubComponents

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify({})
    })
    expect(r.status).toBe(400)
    expect(storage.deleteFailures).not.toHaveBeenCalled()
    expect(fetch.fetch).not.toHaveBeenCalled()
    expect(sqsClient.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects /schedule-processing without auth token', async () => {
    const { localFetch, producer } = components

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      body: JSON.stringify({})
    })
    expect(r.status).toBe(401)
    expect(producer.changeLastRun).not.toHaveBeenCalled()
  })
})
