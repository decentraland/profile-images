import { IHttpServerComponent } from '@well-known-components/interfaces'
import { InvalidRequestError, NotFoundError } from '../../types'

export type ErrorResponse = {
  error: string
  message: string
}

function handleError(error: any): { status: number; body: ErrorResponse } {
  if (error instanceof InvalidRequestError) {
    return {
      status: 400,
      body: {
        error: 'Bad request',
        message: error.message
      }
    }
  }

  if (error instanceof NotFoundError) {
    return {
      status: 404,
      body: {
        error: 'Not found',
        message: error.message
      }
    }
  }

  throw error
}

export async function errorHandler(
  _ctx: IHttpServerComponent.DefaultContext<object>,
  next: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  try {
    return await next()
  } catch (error: any) {
    return handleError(error)
  }
}
