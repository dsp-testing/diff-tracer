import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as github from '@actions/github'

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

  const cachePaths: string[] = ['filelist.txt']
  const primaryKey: string = `${workflow}-${branch}-${commit}`
  const restoreKeys: string[] = [`${workflow}-${branch}-`]

  const cacheKey = await cache.restoreCache(
    cachePaths,
    primaryKey,
    restoreKeys,
    { lookupOnly: false },
    false
  )
  if (!cacheKey) {
    core.info(
      `Cache not found for input keys: ${[primaryKey, ...restoreKeys].join(
        ', '
      )}`
    )
    return false
  }
  let previousCommit = cacheKey.split('-').pop()
  if (!previousCommit) {
    core.warning(`Malformed cache key: ${cacheKey}`)
    return false
  }

  let changedFiles = await getChangedFiles(previousCommit, commit)
  let usedFiles = new Set(
    fs.readFileSync('filelist.txt').toString().split('\n')
  )
  for (let file of changedFiles) {
    if (usedFiles.has(file)) {
      return false
    }
  }
  return true
}

export async function run(): Promise<void> {
  try {
    const skip = await shouldSkip()
    core.setOutput('skip', skip.toString())
    if (skip) {
      core.info('Skipping workflow run')
    } else {
      core.info('Running workflow')
      //TODO: setup tracing
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function getChangedFiles(
  base: string,
  head: string
): Promise<Set<string>> {
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
  let changedFiles = new Set<string>()
  if (data.files) {
    for (let file of data.files) {
      changedFiles.add(file.filename)
    }
  }
  return changedFiles
}

async function finish(): Promise<void> {
  try {
    const commit = process.env['GITHUB_SHA']
    const branch = process.env['GITHUB_REF']
    const workflow = process.env['GITHUB_WORKFLOW']

    const cachePaths: string[] = ['filelist.txt']
    const primaryKey: string = `${workflow}-${branch}-${commit}`

    //TODO: end tracing and collect paths in filelist.txt

    const cacheId = await cache.saveCache(cachePaths, primaryKey, {}, false)

    if (cacheId != -1) {
      core.info(`Cache saved with key: ${primaryKey}`)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

if (!core.getState('isPost')) {
  run()
} else {
  finish()
}
