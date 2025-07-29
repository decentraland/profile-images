import { ImageProcessor } from '../../src/logic/image-processor'

export const createImageProcessorMock = ({
  processEntities = jest.fn()
}: Partial<jest.Mocked<ImageProcessor>> = {}): jest.Mocked<ImageProcessor> => {
  return {
    processEntities
  }
}
