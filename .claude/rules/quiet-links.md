---
paths:
  - "src/263-quiet-text.js"
  - "src/264-quiet-cache.js"
  - "src/265-quiet-links.js"
  - "src/266-quiet-editor.js"
  - "tests/test_graph.js"
---

# Quiet links

Obsidian reads `[[[X]]]` as a link to a missing "[X". They're set aside from
each note's cache in `metadataCache` 'changed' — which fires before Obsidian
counts the note's links — and swept once after 'resolved' for notes it
remembered. That keeps the stand-in out of the graph, backlinks, Outgoing
links, the [[ list and Quick switcher; don't patch those separately. Obsidian
doesn't update quiet links on rename; the plugin does.
