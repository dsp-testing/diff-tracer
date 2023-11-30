#!/usr/bin/env python3
import os
import sys
from inotify_simple import INotify, flags

watch_flags = flags.ACCESS | flags.MODIFY | flags.ATTRIB | flags.OPEN

def debug(*args, **kwargs):
    print("inotify tracer:", *args, file=sys.stderr, **kwargs)

def main():
    root = sys.argv[1]
    
    # We need to construct this list up front since adding new watches causes
    # events to be generated, and we don't want to see our own events.
    dirs_to_watch = []
    
    inotify = INotify()
    
    debug("Enumerating directories under", root)
    # Watch all directories under root, recursively.
    # We shouldn't need to add newly directories to the watch list dynamically
    # since we're just interested in what was in the repo at checkout time.
    for path, dirs, files in os.walk(root):
        # Ignore .git directories recursively by removing them from the list
        if '.git' in dirs:
            dirs.remove('.git')
        dirs_to_watch.append(path)
    debug("Found", len(dirs_to_watch), "directories")

    dir_names = {}

    debug("Registering watches")
    for dir in dirs_to_watch:
        wd = inotify.add_watch(dir, watch_flags)
        dir_names[wd] = dir
    debug("Starting to monitor\n")

    files_seen = set()

    while True:
        for event in inotify.read():
            if event.mask & flags.ISDIR or event.name == '':
                # We don't care about directory events.
                continue
            fullname = str(os.path.join(dir_names[event.wd], event.name))
            if fullname in files_seen:
                # We don't care about duplicate events.
                continue
            files_seen.add(fullname)
            print(fullname, flush=True)

if __name__ == '__main__':
    main()
