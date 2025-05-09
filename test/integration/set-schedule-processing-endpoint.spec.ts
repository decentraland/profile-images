import { test } from '../components'
import { Entity, EntityType } from '@dcl/schemas'
import { ProcessingResult } from '../../src/logic/image-processor'

test('set-schedule-processing endpoint', function ({ components, stubComponents }) {
  it('responds /schedule-processing with success', async () => {
    const { localFetch } = components
    const { entityFetcher, imageProcessor } = stubComponents

    const mockEntity: Entity = {
      id: 'abcd',
      type: EntityType.PROFILE,
      timestamp: 123456789,
      version: 'v3',
      pointers: ['0x123'],
      content: [],
      metadata: {
        avatars: [
          {
            avatar: {
              bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
              snapshots: {
                face: 'face.png',
                body: 'body.png'
              }
            }
          }
        ]
      }
    }

    const mockProcessingResult: ProcessingResult = {
      entity: 'abcd',
      success: true,
      shouldRetry: false,
      avatar: mockEntity.metadata.avatars[0].avatar
    }

    entityFetcher.getEntitiesByIds.resolves([mockEntity])
    imageProcessor.processEntities.resolves([mockProcessingResult])

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify([{ entityId: 'abcd' }])
    })

    expect(r.status).toBe(200)
    const response = await r.json()
    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toEqual({
      entity: 'abcd',
      success: true,
      shouldRetry: false
    })
  })

  it('responds /schedule-processing with invalid body', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify({})
    })

    expect(r.status).toBe(400)
  })

  it('responds /schedule-processing with processing failure', async () => {
    const { localFetch } = components
    const { entityFetcher, imageProcessor } = stubComponents

    const mockEntity: Entity = {
      id: 'abcd',
      type: EntityType.PROFILE,
      timestamp: 123456789,
      version: 'v3',
      pointers: ['0x123'],
      content: [],
      metadata: {
        avatars: [
          {
            avatar: {
              bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
              snapshots: {
                face: 'face.png',
                body: 'body.png'
              }
            }
          }
        ]
      }
    }

    const mockProcessingResult: ProcessingResult = {
      entity: 'abcd',
      success: false,
      shouldRetry: true,
      error: 'Processing failed',
      avatar: mockEntity.metadata.avatars[0].avatar
    }

    entityFetcher.getEntitiesByIds.resolves([mockEntity])
    imageProcessor.processEntities.resolves([mockProcessingResult])

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify([{ entityId: 'abcd' }])
    })

    expect(r.status).toBe(200)
    const response = await r.json()
    expect(response.results).toHaveLength(1)
    expect(response.results[0]).toEqual({
      entity: 'abcd',
      success: false,
      shouldRetry: true,
      error: 'Processing failed'
    })
  })

  it('rejects /schedule-processing without auth token', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/schedule-processing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ entityId: 'abcd' }])
    })

    expect(r.status).toBe(401)
  })
})
