import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as github from '@actions/github'
import * as child_process from 'child_process'

const TRACER_LOG_FILE = 'tracer.log'
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
  const primaryKey = `${workflow}-${branch}-${commit}`
  const restoreKeys: string[] = [`${workflow}-${branch}-`]

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
    fs.readFileSync('filelist.txt').toString().split('\n')
  )
  for (const file of changedFiles) {
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
      let workerPid = process.ppid
      // WORKER_PID="$(ps aux | grep "Runner.Worker" | tr -s ' ' | cut -f2 -d ' ' | head -n1)"
      //  let workerPid = child_process.execSync(`ps aux | grep "Runner.Worker" | tr -s ' ' | cut -f2 -d ' ' | head -n1`, { stdio: 'inherit' }).toString;
      core.info(`Runner PID: ${workerPid}`)
      fs.closeSync(fs.openSync(TRACER_LOG_FILE, 'w'))
      const p = child_process.spawn(
        '/usr/bin/nohup',
        [
          'sudo',
          'strace',
          '-f',
          '-e',
          'trace=open,openat',
          '-o',
          TRACER_LOG_FILE,
          '-p',
          `${workerPid}`
        ],
        { stdio: 'ignore', detached: true }
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

export async function finish(): Promise<void> {
  try {
    const tracerPid = core.getState('tracerPid')
    if (tracerPid) {
      core.info(`Killing tracer process ${tracerPid}`)
      child_process.execSync(`sudo kill ${tracerPid}`)
    } else {
      core.info('Tracer process not found: skipping')
      return
    }
    // cat./ tracer.log | grep $(pwd) | grep 'open' | cut - d "\"" - f2 | sort - u

    let traceLogContents
    try {
      traceLogContents = fs.readFileSync(TRACER_LOG_FILE).toString()
    } catch (err) {
      core.info(`File not found: ${TRACER_LOG_FILE}`)
      return
    }
    core.info(`Trace log:\n${traceLogContents}`)
    let filesUsed = ''
    traceLogContents.split('\n').forEach(line => {
      if (line.includes(process.cwd())) {
        const file = line.split('"')[1]
        core.info(`File used: ${file}`)
        filesUsed += `${file}\n`
      }
    })

    fs.writeFileSync('filelist.txt', filesUsed)
    core.info(`Files used: ${filesUsed}`)

    const commit = process.env['GITHUB_SHA']
    const branch = process.env['GITHUB_REF']
    const workflow = process.env['GITHUB_WORKFLOW']

    const cachePaths: string[] = ['filelist.txt']
    const primaryKey = `${workflow}-${branch}-${commit}`

    const cacheId = await cache.saveCache(cachePaths, primaryKey)

    if (cacheId !== -1) {
      core.info(`Cache saved with key: ${primaryKey}`)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
