import { MessageValidator } from '../../src/logic/message-validator'

export const createMessageValidatorMock = ({
  validateMessages = jest.fn().mockReturnValue({
    validMessages: [],
    invalidMessages: [],
    rateLimitedMessages: []
  }),
  markPointerProcessed = jest.fn()
}: Partial<jest.Mocked<MessageValidator>> = {}): jest.Mocked<MessageValidator> => {
  return {
    validateMessages,
    markPointerProcessed
  }
}
