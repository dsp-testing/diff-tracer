/**
 * Unit tests for the action's entrypoint, src/index.ts
 */

import * as main from '../src/main'

// Mock the action's entrypoint
const mainMock = jest.spyOn(main, 'main').mockImplementation()

describe('index', () => {
  it('calls run when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/index')

    expect(mainMock).toHaveBeenCalled()
  })
})
