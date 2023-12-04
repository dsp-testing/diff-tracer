# Hackathon diff-tracer

This repository is the end result of the November 2023 hackathon to implement [General purpose status checks management using execution tracing](https://github.com/github/code-scanning-hackathon/issues/128)

The original [design document](https://docs.google.com/document/d/1I134wAefXgpRy7SzC7SQT3Zj2PPTfNbR5wH4HXWlNao/edit#heading=h.msq7u3o3f8h6)

# Project Idea 
The original design document was based around the idea of using `strace` to trace the GitHub runner process and track all files touched in the `_work` directory to create a list of all files used during a workflow run and save that trace data with a reference to the workflow, branch and commit information into a cache. The next time the workflow is triggered, we check the cache for the relevant trace data and compare it to the diff between the current workflow commit and the commit of the cached data. this will alow us to establish if any of the files used in the last workflow run has changed in the new commit, therefor allowing us to establish if a new workflow run is required. If false, the workflow run is skipped and no new trace data is cached. If true, the workflow run continues and new trace data is cached. 

# Implementation 
The current implementation (4 Dec 2023) is as follows:

We created a GitHub Action that aims to optimize the execution of workflows by skipping unnecessary runs. It does this by leveraging the caching mechanism provided by GitHub Actions. The main function in this code is shouldSkip(), which determines whether the current workflow run should be skipped based on the changes made in the commit. Here's a high-level overview of how it works:

* **Environment Variables**: It checks if the necessary environment variables (GITHUB_SHA, GITHUB_REF, GITHUB_WORKFLOW) are defined. If not, it logs an error and returns false, indicating the workflow should not be skipped.
* **Cache Restoration**: It constructs a cache key from the workflow name, branch name, and commit SHA. It then attempts to restore the cache using this key, falling back to the most recent entry from the largest prefix of the key components. If the cache is not found, it returns false, indicating the workflow should not be skipped.
* **File Changes**: It extracts the previous commit SHA from the cache key and gets the list of files that have changed between the previous commit and the current commit. If any new files were added, it returns false, indicating the workflow should not be skipped.
* **Used Files**: It reads the list of used files from a temporary file. If any of the changed files are in the used files list, it returns false, indicating the workflow should not be skipped.
* **Running Workflow**: It sets up a file tracer using an inotify python script to track file access during a workflow run and saving the data to a file list.
* **Cache Updating**: If the workflow run was successful, the file list is used to udpate the cache using the cache key.

If all of the conditions for skipping are met, the function returns true, indicating that the workflow can be skipped. This can help save resources by avoiding unnecessary workflow runs when the changes in the commit do not affect the outcome of the workflow.

# Learnings 

During the hackathon we had to make some changes to our implementation due to tool and service limitation. 

## Process tracing vs File tracing.
The original idea was to use a process based tracing mechanism provide the file trace data to be used. It became clear there are some limitations. Process base tracing used relative paths and would require more data like directory changes etc to be accurate. We also had to parse the output of the tracing tool. We investigated [fs_watch](https://emcrisostomo.github.io/fswatch/), which is cross-platform, but the overhead for using it recursively was too expensive. We opted for file base tracing using inotify instead. 

During our testing process base tracing also incurred a high overhead while file based tracing was relatively low. We also had difficulty in successfully tracing the processes in the workflow and did not investigate further once we pivoted to file based tracing. 

## Actions Cache.

Our final hackathon version uses GitHub Actions Cache as our caching store. This has some limitations. 

There are [resitrction for accessing the cache](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows#restrictions-for-accessing-a-cache) which limited how we could use our action. Boundary restrictions between different branches or tags meant that workflow runs can restore caches created in either the current branch or the default branch, but not from from child branches. This meant that PRs runs could get cached data from the `base_ref` of the PR, which allows checking PRs workflow runs, but does not allow main merges of the PR to get the cache of the PR workflow run, hence all PR merges into `main` would still require a full workflow run.

## Networking 

The action does not monitor network interactions and workflows that depend on downloading dynamic data from the internet is not checked. This was considered during the design, but rejected due to limited time.

## Operating Systems

During the development we investigated supporting Windows and macOS as both are also supported in GitHub Actions. Unfortunately we ran out of time to find working solutions for process and/or filesystem based tracing for both platforms.

