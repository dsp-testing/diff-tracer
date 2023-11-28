/**
 * Unit tests for the action's entrypoint, src/index.ts
 */

import * as main from '../src/index'

// Mock the action's entrypoint
const runMock = jest.spyOn(main, 'run').mockImplementation()
const core =
  jest.createMockFromModule<typeof import('@actions/core')>('@actions/core')
const getStateMock = jest.spyOn(core, 'getState').mockImplementation()

describe('index', () => {
  it('calls run when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/index')

    expect(getStateMock).toHaveBeenCalled()
    expect(runMock).toHaveBeenCalled()
  })
})
