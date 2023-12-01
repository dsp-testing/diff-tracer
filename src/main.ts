import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as github from '@actions/github'
import * as child_process from 'child_process'

const FILELIST_TXT = `${process.env['RUNNER_TEMP']}/filelist.txt`

async function shouldSkip(): Promise<boolean> {
  const commit = process.env['GITHUB_SHA']
  const branch = process.env['GITHUB_REF']
  const workflow = process.env['GITHUB_WORKFLOW']
  if (!commit) {
    core.error('GITHUB_SHA is not defined')
    return false
  }
  if (!branch) {
    core.error('GITHUB_REF is not defined')
    return false
  }
  if (!workflow) {
    core.error('GITHUB_WORKFLOW is not defined')
    return false
  }

  const cachePaths: string[] = [FILELIST_TXT]
  const primaryKey = `${workflow}-${branch}-${commit}`

  // If an exact match can't be found, the cache action will try each of these
  // fallbacks in order, picking the most recent entry if one exists. The
  // access control rules for the Actions cache service will ensure that
  // unrelated branches are not mixed up.
  const restoreKeys: string[] = [`${workflow}-${branch}-`, `${workflow}-`]

  const cacheKey = await cache.restoreCache(
    cachePaths,
    primaryKey,
    restoreKeys,
    { lookupOnly: false },
    false
  )
  if (cacheKey) {
    core.info(`Cache restored with key: ${cacheKey}`)
  } else {
    core.info(
      `Cache not found for input keys: ${[primaryKey, ...restoreKeys].join(
        ', '
      )}`
    )
    return false
  }
  const previousCommit = cacheKey.split('-').pop()
  if (!previousCommit) {
    core.warning(`Malformed cache key: ${cacheKey}`)
    return false
  }

  const [changedFiles, added] = await getChangedFiles(previousCommit, commit)
  if (added) {
    return false
  }
  const usedFiles = new Set(
    fs.readFileSync(FILELIST_TXT).toString().split('\n')
  )
  for (const file of changedFiles) {
    if (usedFiles.has(file)) {
      return false
    }
  }
  return true
}

async function run(): Promise<void> {
  try {
    const skip = await shouldSkip()
    core.setOutput('skip', skip.toString())
    if (skip) {
      core.info('Skipping workflow run')
    } else {
      core.info('Running workflow')
      // Find the directory containing this script
      const actionDir = __dirname
      const tracerPath = `${actionDir}/../tools/inotify-tracer.py`
      core.info(`Tracer path: ${tracerPath}`)
      // Start the tracer, redirecting stdout to FILELIST_TXT
      const p = child_process.spawn(
        '/usr/bin/nohup',
        [tracerPath, FILELIST_TXT, '.'],
        { stdio: 'inherit', detached: true }
      )
      core.saveState('tracerPid', p.pid)
      p.unref()
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

// Returns a pair of (set of changed files, whether any were added)
async function getChangedFiles(
  base: string,
  head: string
): Promise<[Set<string>, boolean]> {
  // use github rest api to get changed files
  // https://docs.github.com/en/rest/commits/commits#compare-two-commits
  const token = process.env['GITHUB_TOKEN'] || ''
  const octokit = github.getOctokit(token)
  const [owner, repo] = process.env['GITHUB_REPOSITORY']?.split('/', 2) || []
  const { data: data } = await octokit.rest.repos.compareCommits({
    owner,
    repo,
    base,
    head
  })
  const changedFiles = new Set<string>()
  if (data.files) {
    for (const file of data.files) {
      changedFiles.add(file.filename)
    }
  }
  // TODO: should we account for other statuses?
  const added = data.files?.some(file => file.status === 'added')
  return [changedFiles, !!added]
}

async function finish(): Promise<void> {
  try {
    const tracerPid = core.getState('tracerPid')
    if (tracerPid) {
      core.info(`Killing tracer process ${tracerPid}`)
      process.kill(parseInt(tracerPid, 10))
    } else {
      core.info('Tracer process not found: skipping')
      return
    }
    // For debugging, print the contents of the filelist
    const filesUsed = fs.readFileSync(FILELIST_TXT).toString()
    core.info(`Files used:\n${filesUsed}`)

    const commit = process.env['GITHUB_SHA']
    const branch = process.env['GITHUB_REF']
    const workflow = process.env['GITHUB_WORKFLOW']

    const cachePaths: string[] = [FILELIST_TXT]
    const primaryKey = `${workflow}-${branch}-${commit}`

    const cacheId = await cache.saveCache(cachePaths, primaryKey)

    if (cacheId !== -1) {
      core.info(`Cache saved with key: ${primaryKey}`)
    }
  } catch (error) {
    if (error instanceof Error) core.warning(error)
  }
}

export async function main(): Promise<void> {
  if (!core.getState('isPost')) {
    core.saveState('isPost', 'true')
    await run()
  } else {
    await finish()
    process.exit(0)
  }
}
