import { GodotComponent } from '../../src/adapters/godot'

export const createGodotMock = ({
  generateImages = jest.fn()
}: Partial<jest.Mocked<GodotComponent>> = {}): jest.Mocked<GodotComponent> => {
  return {
    generateImages
  }
}
