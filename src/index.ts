/**
 * The entrypoint for the action.
 */
import { run, finish } from './main'
import * as core from '@actions/core'

if (!core.getState('isPost')) {
  run()
} else {
  finish()
}

