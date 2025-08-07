import { test } from '../components'
import { Entity, EntityType } from '@dcl/schemas'
import { ProcessingResult } from '../../src/logic/image-processor'

test('when scheduling processing', function ({ components, stubComponents }) {
  describe('when the request is valid', () => {
    let mockEntity: Entity
    let mockProcessingResult: ProcessingResult

    beforeEach(() => {
      const { entityFetcher } = stubComponents

      mockEntity = {
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

      entityFetcher.getEntitiesByIds.onFirstCall().resolves([mockEntity])
    })

    afterEach(() => {
      stubComponents.entityFetcher.getEntitiesByIds.reset()
      stubComponents.imageProcessor.processEntities.reset()
    })

    describe('and the processing succeeds', () => {
      beforeEach(() => {
        const { imageProcessor } = stubComponents

        mockProcessingResult = {
          entity: 'abcd',
          success: true,
          shouldRetry: false,
          avatar: mockEntity.metadata.avatars[0].avatar
        }

        imageProcessor.processEntities.onFirstCall().resolves([mockProcessingResult])
      })

      it('should respond with success', async () => {
        const { localFetch } = components

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
    })

    describe('and the processing fails', () => {
      beforeEach(() => {
        const { imageProcessor } = stubComponents

        mockProcessingResult = {
          entity: 'abcd',
          success: false,
          shouldRetry: true,
          error: 'Processing failed',
          avatar: mockEntity.metadata.avatars[0].avatar
        }

        imageProcessor.processEntities.onFirstCall().resolves([mockProcessingResult])
      })

      it('should respond with processing failure', async () => {
        const { localFetch } = components

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
    })

    describe('and the request is unauthorized', () => {
      it('should respond with unauthorized', async () => {
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
  })

  describe('when the request is invalid', () => {
    describe('when the request body is empty', () => {
      it('should respond with invalid request', async () => {
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
    })

    describe('when the request body is not an array', () => {
      it('should respond with invalid request', async () => {
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
    })

    describe('when the request body has more than 10 entities', () => {
      let mockEntities: Entity[]

      beforeEach(() => {
        mockEntities = Array.from({ length: 11 }, (_, i) => ({
          id: `entity-${i}`,
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
        }))
      })

      it('should respond with invalid request', async () => {
        const { localFetch } = components

        const r = await localFetch.fetch('/schedule-processing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret'
          },
          body: JSON.stringify(mockEntities)
        })

        expect(r.status).toBe(400)
      })
    })
  })
})
