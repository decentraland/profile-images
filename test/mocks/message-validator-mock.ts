import { MessageValidator } from '../../src/logic/message-validator'

export const createMessageValidatorMock = ({
  validateMessages = jest.fn().mockReturnValue({
    validMessages: [],
    invalidMessages: []
  })
}: Partial<jest.Mocked<MessageValidator>> = {}): jest.Mocked<MessageValidator> => {
  return {
    validateMessages
  }
}
