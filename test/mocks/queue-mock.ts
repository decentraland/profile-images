import { QueueComponent } from '../../src/logic/queue'

export const createQueueMock = ({
  receiveMessage = jest.fn(),
  sendMessage = jest.fn(),
  deleteMessage = jest.fn(),
  deleteMessages = jest.fn(),
  getStatus = jest.fn().mockReturnValue({ isProcessing: false })
}: Partial<jest.Mocked<QueueComponent>> = {}): jest.Mocked<QueueComponent> => {
  return {
    receiveMessage,
    sendMessage,
    deleteMessage,
    deleteMessages,
    getStatus
  }
}
