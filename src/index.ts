/**
 * The entrypoint for the action.
 */
import { run, finish } from './main'
import * as core from '@actions/core'

if (!core.getState('isPost')) {
  core.saveState('isPost', 'true')
  void run()
} else {
  void finish()
}
