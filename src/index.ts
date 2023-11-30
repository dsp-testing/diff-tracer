/**
 * The entrypoint for the action.
 */
import { run, finish } from './main'
import * as core from '@actions/core'

if (!core.getState('isPost')) {
  core.saveState('isPost', 'true')
  run()
} else {
  finish()

  // For some reason the Node process tends to hang here, so we'll exit the process manually.
  process.exit(0)
}
