/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import esmock from 'esmock'
import { logger, LogLevel } from '../../lib/util/logger.js'

describe('Helpers', () => {
  describe('callWithRetry', () => {
    let callWithRetry

    before(async () => {
      const helpersModule = await esmock('../../lib/util/helpers.js', {
        '../../lib/util/auth-error.js': {
          getAuthErrorMessage: () =>
            'A required API is not enabled in the Google Cloud project that owns your OAuth client. Your credentials have insufficient scopes',
        },
        '../../lib/constants.js': {
          DEFAULT_CONFIG: {
            MAX_RETRIES: 3,
            INITIAL_BACKOFF_MS: 1,
            FIRST_RETRY_BACKOFF_MS: 1,
          },
          TAGS: { API: '[api]' },
          ERROR_MESSAGES: {
            INSUFFICIENT_SCOPES: 'Request had insufficient authentication scopes.',
            API_NOT_USED_IN_PROJECT: 'API has not been used in project',
          },
        },
      })
      callWithRetry = helpersModule.callWithRetry
    })

    test('When function succeeds, then it returns the result immediately', async () => {
      const result = await callWithRetry(async () => 'success', 'test')
      assert.strictEqual(result, 'success')
    })

    test('When PERMISSION_DENIED (code 7) occurs, then it surfaces immediately without retry', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        const error = new Error('Permission denied')
        error.code = 7
        throw error
      }

      await assert.rejects(
        async () => {
          await callWithRetry(fn, 'test immediate throw')
        },
        { code: 7 },
      )
      assert.strictEqual(attempts, 1)
    })

    test('When SERVICE_DISABLED error occurs, then it throws a helpful message and does not retry', async () => {
      logger.setLevel(LogLevel.SILENT) // Suppress expected error logs
      try {
        let attempts = 0
        const apiError = new Error(
          'Admin SDK API has not been used in project 123456789 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project=123456789 then retry.',
        )

        await assert.rejects(
          async () => {
            await callWithRetry(async () => {
              attempts++
              throw apiError
            }, 'test service-disabled error')
          },
          err => {
            return err.message.includes('A required API is not enabled')
          },
        )
        assert.strictEqual(attempts, 1)
      } finally {
        logger.setLevel(LogLevel.ERROR) // Restore level
      }
    })

    test('When INSUFFICIENT_SCOPES error occurs, then it throws a helpful message and does not retry', async () => {
      logger.setLevel(LogLevel.SILENT) // Suppress expected error logs
      try {
        let attempts = 0
        const scopeError = new Error('Request had insufficient authentication scopes.')

        await assert.rejects(
          async () => {
            await callWithRetry(async () => {
              attempts++
              throw scopeError
            }, 'test scope error')
          },
          err => {
            return err.message.includes('Your credentials have insufficient scopes')
          },
        )
        assert.strictEqual(attempts, 1)
      } finally {
        logger.setLevel(LogLevel.ERROR) // Restore level
      }
    })
  })

  describe('handleApiError', () => {
    test('When error.response.data.error is an object, then it preserves status and code on the thrown Error', async () => {
      const { handleApiError } = await import('../../lib/util/helpers.js')
      const apiErr = {
        response: {
          data: {
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: 'Impersonated user lacks Admin Console privileges',
            },
          },
        },
      }
      assert.throws(
        () => handleApiError(apiErr, '[test]', 'operation'),
        err => {
          assert.strictEqual(err.status, 403)
          assert.strictEqual(err.code, 403)
          return true
        },
      )
    })

    test('When error.response.data.error is a string, then it preserves status from response.status', async () => {
      const { handleApiError } = await import('../../lib/util/helpers.js')
      const apiErr = {
        response: {
          status: 400,
          data: {
            error: 'invalid_grant',
            error_description: 'Bad Request',
          },
        },
      }
      assert.throws(
        () => handleApiError(apiErr, '[test]', 'operation'),
        err => {
          assert.strictEqual(err.status, 400)
          return true
        },
      )
    })
  })
})
