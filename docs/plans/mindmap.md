<!-- Mind maps beyond the canvas (Oct 18, 2026), as text from the PDF it came in. -->

Untitled




  Mind maps beyond the canvas
     Oct 18, 2026    · ​@Aidan

  Design Redux gets its own mind-map view, built on a plain markdown note instead of
  Obsidian's canvas, and every canvas feature moves to it in eight phases.


  Why a separate view
  The canvas is the wrong host for a mind map: Design Redux spends about 11,800 lines in 35
  modules fighting it, and a tree has no need of what a canvas gives.

           It leans on Obsidian internals. Folds wrap the canvas's hit testing, arrows wrap its
           edge prototype, and saves go through overrideHistory . All of it sits behind the
           adapter ( core/079 , 367 lines) and any Obsidian update can break it.
           The file hides the tree. A canvas is JSON of boxes and arrows. The tree exists only as
           arrows plus our drNudge , drLayout , drTuck , drRoom and drMaster keys, so search,
           backlinks, Sync diffs and other plugins see nothing.
           Layout fights the user. A live map turns hand-moved cards into nudges, reorders them
           when dragged past a neighbour, and saves into the current Undo step. Each rule exists
           to cover a gap between a free-form surface and a tree.
           Cost. 52 canvas* settings, 80 simulation tests in test_canvas.js and about 20 real-
           Obsidian tests exist to hold this together.

  A mind-map view owns its drawing, its file and its Undo. The tree is the data, layout is a
  pure function of it, and the rest of the plugin (albums, panel, links, graph) reads the map
  as a note.




                                                                                                  Page 1 of 27
Untitled




  The shape




  architecture · two hosts over one tree core

  The tree logic moves out of the canvas into a pure area both hosts import, so the new view
  is built without touching Obsidian's canvas and the old one keeps working.


  The file
  A mind map is an ordinary .md note with mindmap: true in its properties; the nodes are
  a nested list, so Obsidian indexes, links, searches and syncs it like any other note.

     ---
     mindmap: true
     mindmap-layout: right
     ---
     - Launch plan ^root %%{"color":2}%%
         - Research
             - [[Competitor notes]]
             - Interview script %%{"fold":1}%%
         - Build ^build
             - API
             - UI %%{"master":1}%%
         - Ship



                                                                                          Page 2 of 27
Untitled




     ## Free nodes
     - Open question ^q1


     ## Relations
     - ^build -> ^q1 "blocks" %%{"style":"dashed"}%%


     ```design-redux-layout
     {"v":1,"nudge":{"build":[40,-12]},"view":[0,0,1]}
     ```


  Grammar, so parse and write round-trip byte for byte:

           Nodes. One list item per node; indentation is depth. A node's text is its markdown, so
           [[links]] , tags and embeds stay real and show in backlinks and the graph. A multi-
           line node continues on indented lines.
           Ids. A node gets a ^id only when something points to it (a relation, a view, a
           bookmark). Ids are short and stable; the writer never renames one.
           Attributes. Colour, fold, master, pin and similar sit in one trailing %%{...}%% comment
           per node. Obsidian hides it in reading view and other tools ignore it.
           Free nodes and relations. Notes not in the tree and the arrows between any two
           nodes live in their own sections, one line each.
           Layout. Hand nudges, per-branch layout and the last view sit in one fenced design-
           redux-layout JSON block at the end. Everything in it is derivable, so deleting it loses
           only nudges.
           Groups. A group is an attribute on a node ( "group":"Phase 1" ), drawn as a frame
           around the branch.

  The parser accepts hand-written lists with none of this and writes only what changed, so
  a map edited as text never gets noise added.


  The .mindmap file
  A second file kind, .mindmap , holds the same tree as JSON and opens straight in the
  mind-map view with no takeover. The markdown note stays the default; .mindmap is for
  maps that should not look like notes.




                                                                                              Page 3 of 27
Untitled




     {
       "v": 1,
       "layout": "right",
       "root": {
         "id": "root", "text": "Launch plan", "color": 2,
         "children": [
           { "id": "n1", "text": "Research", "children": [
             { "id": "n2", "text": "[[Competitor notes]]" } ] },
           { "id": "build", "text": "Build", "fold": true, "children": [] }
         ]
       },
       "free": [ { "id": "q1", "text": "Open question" } ],
       "relations": [ { "from": "build", "to": "q1", "label": "blocks", "style":
     "dashed" } ],
       "nudge": { "build": [40, -12] },
       "view": [0, 0, 1]
     }


           Registration. registerExtensions(['mindmap'], 'design-redux-mindmap') and a
           TextFileView whose getViewData and setViewData use the same tree/ parse and
           write as the markdown host. It shows in the file explorer, the quick switcher and
           [[Plan.mindmap]] links.
           Same model. tree/ reads and writes two formats, markdown and JSON, into one
           TreeModel . Every feature in the transfer table works on both, and a map converts
           either way without loss (the markdown grammar and the JSON carry the same
           attributes).
           Stable text. Keys are written in a fixed order, two-space indent, one node per line, so
           diffs stay small.
           What it gives up. Obsidian does not parse links inside a .mindmap , so a [[link]] in a
           node is not a backlink or a graph edge and the core search skips it. Design Redux's
           libraryIndex reads them so its own screens (panel mentions, album sync) still see
           them.
           Which to choose. Markdown note when the map is part of the vault's writing;
           .mindmap for diagrams, large maps and anything that should not appear in note lists.
           "New mind map" asks once and remembers the answer in the mindmapDefaultFormat
           setting.




                                                                                               Page 4 of 27
Untitled




           Phase. Registration and the JSON reader land in M1 beside the markdown reader; the
           byte-stable round-trip test covers both. The converter in M5 adds "Convert to
           .mindmap" and "Convert to note".


  Opening it
  The plugin swaps a note's view to the mind map when its properties say mindmap: true ,
  and one command swaps it back to plain text.

           Takeover. On file-open and layout-change , a leaf showing the Markdown view of a
           flagged note is set to a MindMapView with the same file. This is the approach
           Excalidraw uses, and it needs no custom extension.
           Switching. A command and a view-header button toggle "Open as text" and "Open as
           mind map". A leaf remembers its choice for that file, so a text edit is not undone by the
           next reopen.
           New maps. "New mind map" writes the flagged note with one root node; "Make this
           note a mind map" turns an existing list into one without changing its text.
           Degrades well. Without the plugin, or when takeover fails, the note is still a readable
           outline. Nothing in it needs the view to make sense.
           Fallback if takeover breaks. Setting mindmapTakeover off keeps maps as text and
           offers an "Open mind map" button in the note panel instead.


  Code layout
  Two new areas sit in the layers: tree (pure, no DOM) below the features, and mindmap
  (the view) beside canvas , so neither imports the other.




                                                                                               Page 5 of 27
Untitled




     Area                  Holds                                                  Imports from

      core                 existing services, plugin.notes , libraryIndex         nothing above

      tree (new)           TreeModel , layouts, outline parse and write, edit     core
                           operations with undo patches, relations and
                           arguments data, check, compare, find

      canvas               legacy canvas features, now calling tree for logic     core , tree , ui

      mindmap (new)        MindMapView , drawing, input, features on top of       core , tree , ui
                           tree


           First move (M0). 325-canvas-layouts mixes pure layout ( layoutPlaces ,
           outlineLayout , orderedBranch , siblingOrder ) with canvas calls. The pure parts
           move to tree/ and canvas imports them back; its 80 tests must pass unchanged.
           The view. DOM nodes for cards and one SVG layer for edges. It has its own pan and
           zoom, draws only what is on screen, edits text in a small CodeMirror 6 editor, and
           shows idle cards through MarkdownRenderer.render .
           Saving. The view keeps its own Undo stack, writes through a debounced
           vault.modify , and reloads when the file changes outside it. No overrideHistory , no
           wrapped prototypes.
           Adapter. Nothing new touches Obsidian internals, so core/079 stays as it is and
           shrinks when canvas goes.
           Housekeeping. AREAS in tests/map.js gets the two areas; node tests/map.js --
           check --update records the layer rules.



  Every canvas feature, and where it goes
  All 35 canvas modules have a row: 27 are ported, 5 become automatic because the tree is
  the file, 2 are replaced by layout, and 1 is not needed. Nothing is dropped without a row
  saying why.


     Canvas modules                Feature                    In the mind map                    Phase

     315 feature, 321 extras       Canvas feature base,       Ported: MindMapFeature             M1
                                   small extras               base class; extras sorted into
                                                              the rows below




                                                                                                  Page 6 of 27
Untitled




     Canvas modules        Feature                    In the mind map                        Phase

     316 tree, 335 fold    Tree from arrows,          Ported: the tree is the file;          M1
                           branch folding             fold is a node attribute fold

     317 room, 336 tucks   Room records               Automatic: a fold hides its            M1
                           ( drRoom ), tucked cards   subtree and layout closes the
                                                      gap, so no record to keep

     318 motion            Glide animation            Ported: layout transitions on          M3
                                                      the view, off when reduced
                                                      motion is set

     337 peek              Peek at a folded branch    Ported: hover or key shows             M3
                                                      the hidden subtree in a
                                                      popover

     334 mindmap, 348      Live mind-map engine,      Ported: drNudge becomes                M2
     map, 349 toolbar      nudges, ghost, toolbar     layout-block nudge ; the
                                                      ghost stays; tidy happens on
                                                      every change

     325 layouts           Right, left, both, down,   Ported: pure code in tree/ ,           M0
                           outline layouts            shared

     322 cards             Cards grow to fit, title   Ported: nodes size to text;            M3
                           and details                first line is the title, the rest is
                                                      details

     323 restructure       Move, indent, promote,     Ported: tree operations with           M2
                           split, merge               undo patches

     341 quick add, 342    Tab and Enter to add,      Ported: key handling in the            M2
     paste                 paste lines as nodes       view; paste parses a list or
                                                      lines

     343 branch drag       Drag a branch to a new     Ported: drag shows a drop              M2
                           parent                     target and the ghost

     332 arrows            Arrow styles, drArrow      Ported: relation attribute             M3
                                                      style ; tree edges follow the
                                                      branch colour

     326 relations, 319    Typed links, pro and con   Ported: Relations section;             M4
     arguments             branches                   arguments are node
                                                      attributes with a summary



                                                                                              Page 7 of 27
Untitled




     Canvas modules            Feature                   In the mind map                  Phase

     333 arrange, 330 align,   Arrange, align, pinned    Replaced: layout does arrange    M3
     344 pins                  cards                     and align; pins stay as node
                                                         attribute pin

     320 legend, 347 depth     Colour legend, depth      Ported: reads the same colour    M3
                               colouring                 attribute; legend is a view
                                                         overlay

     338 branches              Branch to note, note to   Ported: the branch becomes a     M4
                               branch                    note and the node a link to it

     339 outline, 324          Outline pane, map to      Automatic: the file is the       M1
     outlines, 345 outline     outline and back          outline; the pane shows the
     sync                                                same tree

     346 views                 Saved views, zoom to      Ported: views are ^id plus a     M3
                               branch                    layout-block entry

     327 check, 331            Map check, compare        Ported: pure checks in tree/ ;   M4
     compare                   two maps                  compare reads two files

     328 vault map, 329        Map of the vault,         Ported: vault map builds a       M4
     minimap                   minimap                   mind-map file; minimap reads
                                                         the view's bounds

     340 diagnostics           Canvas-internals          Not needed: nothing of           M7
                               diagnostics               Obsidian's to diagnose


  The 52 canvas* settings follow their module's row: ported ones are copied, automatic
  and not-needed ones are retired (see Settings and commands).


  Beyond the canvas: new features
  Once the tree is the data, sixteen things the canvas could not do cheaply become
  ordinary work. They come after parity, in three extension phases (E1 to E3, about 15
  sessions on top of the 28).




                                                                                           Page 8 of 27
Untitled




     #     Feature          What it does                  Why it is cheap here            Phase

     1     Tasks in nodes   - [ ] nodes with due          A checkbox is already list      E1
                            dates and a status chip; a    syntax; roll-up is a pure
                            parent shows a progress       function of the tree
                            ring from its children;
                            filter to open tasks

     2     Other views      Outline, Kanban by status     Each view is a projection of    E1
           of one tree      or tag, Timeline of dated      TreeModel ; edits go through
                            nodes, Table with node        the same operations
                            properties as columns

     3     Linked-note      A node that links a note      noteProps and                   E1
           cards            shows its status, due date    libraryIndex already give
                            and first line, read live     this; no copy to keep in sync
                            from the note

     4     Node panel       The note panel gains a        PanelSection (082) and          E1
                            section for the selected      plugin.files exist
                            node: text, attributes,
                            who links to it, "Make a
                            note from this node"

     5     Focus and        Dim by search, tag, status,   Filters run on the model, the   E1
           filter           colour or depth; show to      view only dims
                            level N; solo a branch with
                            a breadcrumb

     6     Map in any       A mindmap code block or       The renderer takes any          E2
           note              ![[Map]] draws a live,       TreeModel
                            read-only map in reading
                            view and Live Preview;
                            click opens it

     7     Drag and drop    Drop a note from the file     Operations plus                 E2
                            explorer to add a link        plugin.files
                            child, an image to add an
                            image node, a list from the
                            clipboard to add a branch




                                                                                               Page 9 of 27
Untitled




     #     Feature          What it does                Why it is cheap here          Phase

     8     Templates        "New from template" for     A template is a map file;     E2
                            meeting, project,           placeholders are plain text
                            argument and study
                            maps, kept as ordinary
                            maps in a folder

     9     Import and       Import OPML, FreeMind       tree/ parse and write         E2
           export           ( .mm ) and heading         functions with fixtures
                            outlines; export OPML,
                            PNG, SVG, PDF

     10    Keyboard first   Arrow navigation, type to   DOM nodes can carry           E2
                            jump, every action in the   role="treeitem" ; a canvas
                            command palette, tree       cannot
                            roles so a screen reader
                            can walk the map

     11    Cross-map        [[Map#^id]] opens that      ^id anchors are real block    E2
           links            map focused on the node;    ids
                            a node shows the maps
                            and notes that link to it

     12    Query nodes      A node with a query         libraryIndex answers the      E3
                            ( tag , folder ,            query; children are virtual
                             property , links to )      until frozen
                            whose children are the
                            matching notes, live;
                            "Freeze" turns them into
                            real children

     13    Map history      The last N autosaves per    tree/ compare exists from     E3
                            map, browse and restore,    M4; snapshots keyed by path
                            compare any two with the    in PATH_KEYED
                            compare feature

     14    Present          Spotlight and speaker       Focus and fold are model      E3
                            notes from the node's       operations
                            details, on top of the
                            basic present mode built
                            in M4 (2.1 Change 4)




                                                                                       Page 10 of 27
Untitled




     #          Feature          What it does                   Why it is cheap here           Phase

     15         More layouts     Radial, org chart, fishbone    New pure functions in          E3
                                 and timeline spine,            tree/layouts
                                 chosen per branch like
                                 today's layouts

     16         Rich nodes       Images, icons, shapes          DOM nodes can hold             E3
                                 (pill, box, underline), per-   anything; attributes already
                                 depth themes, a details        carry style
                                 field that renders
                                 markdown


  Nothing here needs a network or Obsidian internals, and each is behind its own setting so
  a user who wants a plain outline map can switch it off.


  Settings and commands
  Every existing command id keeps working on a mind map, and every canvas* setting is
  copied to a mindmap* key once, so no hotkey or preference is lost.

           Commands. About 80 ids name a canvas ( canvas-quick-add , fold-canvas-branch ,
           arrange-canvas-left , tidy-canvas-branch and so on). Each one's action gets on:
           'mindmap' beside on: 'canvas' in 078-actions.js ; the id stays, and the command
           acts on whichever of the two is open. Hotkeys hang on ids, so none are renamed. New
           wording appears only in labels ("Fold branch" in both).
           Settings. Each ported canvas* key that only a map uses gets a mindmap* twin in
           DEFAULTS and SETTINGS_TABS . A SETTINGS_MIGRATIONS step copies the user's value
           on first run of the new version and leaves the canvas key in place. Retired keys (room,
           tucks, outline sync, diagnostics) are dropped by the existing stale-key pass.
           Shared keys. Colours, spacing and layout defaults stay one setting each, moved to a
           tab section named "Maps" that both hosts read, so they get no twin.
           Per-file keys. canvasMapFiles has no twin: a map is recognised by its mindmap
           property. Anything else keyed by a path goes in PATH_KEYED .
           Tests. tests/test_lifecycle.js --update records the new keys. The lifecycle test
           already refuses a dropped command id or setting key without a migration, which
           guards this plan.




                                                                                                Page 11 of 27
Untitled




  Migration and coexistence
  Canvas support stays until the mind map passes every row of the transfer table, then
  goes in a later major release, not this one.

    1. Convert. "Convert canvas to mind map" reads a canvas with the existing tree code,
       writes a flagged note beside it, and maps drNudge , drLayout , drTuck , drMaster and
           drArrow to node attributes and the layout block. Cards that are files become
           [[links]] ; free cards go to Free nodes; groups become group attributes. The canvas
           is never changed or deleted.
    2. Check. A round-trip test converts every canvas fixture, lays it out in both hosts and
       compares card positions within 1 px.
    3. Export. A mind map exports to a canvas (so it opens anywhere canvas does), to an
           outline note (already the file), and to PNG, SVG and PDF from the view.
    4. Coexist. Both hosts run side by side in 2.x. New maps default to the mind map once
       phase M5 passes, with a setting to make new ones canvases.
    5. Retire. A later release stops offering canvas maps, keeps the converter and export,
       and removes the adapter and the wrapped canvas prototypes (the 340 diagnostics
       module already went in M7).

  The 2.1 plan's Change 4 (present a map) and Change 5 (album and map sync) are built on
  this view instead of the canvas, so they wait for phase M4.




                                                                                          Page 12 of 27
Untitled




  Phases




  roadmap · 8 phases, a gate each, not to scale

  Phases ship in order, each behind a setting, and the canvas keeps working throughout. M0
  changes no behaviour, which makes it the safest first session and the proof the extraction
  is clean. The three extension phases E1 to E3 (about 15 sessions) come after M7 and add
  the new features; their task lists are under Build 3, and each list can be pasted as a prompt
  in the same form as the M0 to M7 prompts.


  Build 1: modules and types
  The build adds about 45 modules and roughly 11,600 lines (4,500 in tree , 7,100 in
    mindmap ), about the size of the 11,800 lines in canvas it replaces, but with no Obsidian
  internals and with the extension features included. Module numbers are labels: load order
  comes from the import order in src/main.js , so tree takes 400 to 419 and mindmap
  420 to 459, both unused, and node tests/map.js --fix-imports writes the imports.


    src/tree/ (pure, imports only core )


     Module                  Exports                                          Lines

     400-tree-model          TreeModel , newId , walk , pathOf , cloneModel   300




                                                                                          Page 13 of 27
Untitled




     Module               Exports                                               Lines

     401-tree-outline     parseOutline , writeOutline (markdown host)           500

     402-tree-json        parseMindmapJson , writeMindmapJson                   200
                          ( .mindmap )

     403-tree-layouts     layoutPlaces and one function per layout (right,      700
                          left, both, down, up, outline, radial; E3: org,
                          fishbone, spine)

     404-tree-ops         add, remove, move, indent, promote, reorder, split,   500
                          merge, duplicate and paste subtree, set text, set
                          attribute

     405-tree-history     UndoStack with typing coalesced                       150

     406-tree-relations   relations, arguments, summaries                       250

     407-tree-check       checkModel                                            200

     408-tree-compare     diffModels (added, removed, moved, changed)           250

     409-tree-find        searchModel , filterModel (tag, status, colour,       200
                          depth)

     410-tree-views       projections: outline rows, Kanban columns,            350
                          timeline items, table rows (E1)

     411-tree-progress    task roll-up and due dates (E1)                       150

     412-tree-query       parseQuery , runQuery(index) with the index           250
                          passed in (E3)

     413-tree-import      OPML, FreeMind, headings in (E2)                      300

     414-tree-export      OPML, canvas JSON out (E2)                            200



    src/mindmap/ (imports core , tree , ui )


     Module                    What it holds                                          Lines

     420-mindmap-feature        MindMapFeature base: settings, registration           150

     421-mindmap-view           MindMapView , one class for .md and .mindmap          500
                               through a FileFormat



                                                                                              Page 14 of 27
Untitled




     Module                 What it holds                                            Lines

     422-mindmap-takeover   swap a flagged note's leaf to the view; "Open as         250
                            text" memory

     423-mindmap-scene      visible set, spatial grid, size cache, viewport maths,   450
                            hit test

     424-mindmap-render     node DOM pool, one SVG edge layer, selection and         600
                            ghost layers

     425-mindmap-input      pointer, wheel, pinch, drag, keyboard map                500

     426-mindmap-editor     CodeMirror 6 mount for the node being edited             250

     427-mindmap-save       debounced write, external-change reload, own-            300
                            write guard

     428-mindmap-motion     layout glide, reduced-motion switch                      150

     430 to 449             ported features, one module per row group of the         2,200
                            transfer table (fold, peek, legend, depth, views,
                            pins, relations, arguments, branch to note, check,
                            compare, vault map, minimap, present, toolbar)

     450 to 459             extension features (E1 to E3): tasks, views, panel       1,800
                            section, embed, drop, templates, history, queries,
                            rich nodes




                                                                                             Page 15 of 27
Untitled




  Core types

     /** One node. `text` is markdown; `attrs` is the %%{}%% object. */
     // Node = { id, text, attrs, children: Node[], parent: Node|null }


     /** The whole map. `free` nodes have no parent; `relations` link any two ids.
     */
     // TreeModel = { root, free: Node[], relations: Relation[], layout:
     LayoutState, rest: string }

     /** What a change did, and how to undo it; ids only, never object references.
     */
     // Patch = { ops: Op[], inverse: Op[], selection: string[] }

     /** One file kind. The view knows nothing else about files. */
     // FileFormat = { id, extensions, parse(text) -> { model, extras },
     write(model, previousText) -> text }

     /** What the view reads of the vault; passed in so tree code stays testable.
     */
     // MapHost = { noteProps(path), outgoing(path), incoming(path),
     notesWhere(query) }


    rest holds everything in a markdown note that is not the map (prose above or below the
  list), so a note with writing around its map keeps it byte for byte.


  Build 2: how the hard parts work
  Six mechanisms decide whether the view feels native, and each has a fixed design so no
  session has to invent it.

    1. Takeover. A feature registers file-open and active-leaf-change . For a Markdown
       leaf whose file has mindmap in metadataCache frontmatter, and that is not in the leaf's
           "open as text" memory, it calls leaf.setViewState({ type: 'design-redux-
           mindmap', state: { file } }) . The call sits in one core function behind typeof
           checks and is recorded in node tests/map.js --internals --update . The leaf's
           choice is remembered in the leaf's own view state, never in settings. .mindmap needs
           none of this: registerExtensions opens it directly.
    2. Writing without noise. parseOutline records each node's source line span.
           writeOutline(model, previousText) copies untouched spans verbatim, regenerates
           only changed nodes, and leaves rest alone. The test is: parse any note, write it with no


                                                                                             Page 16 of 27
Untitled




           change, get the same bytes. Attributes append as one %%{}%% per node in a fixed key
           order. Ids are added only when a relation, view or link needs them.
    3. Saving and outside changes. Every edit applies a Patch to the model, re-draws, and
       schedules a write 400 ms later (flushed on blur, close and quit). The view stores the
       hash of what it last wrote. On vault.on('modify') , a file whose hash is not that one is
           an outside change: with nothing unsaved the model is replaced and selection kept by
           id; with unsaved edits the local patches are re-applied by id onto the new model, and if
           one cannot be, the outside version wins and the local one is put in map history with a
           notice.
    4. Undo. UndoStack holds patches. Typing in one node within 800 ms is one step; a
           structural change is always its own step. Cmd or Ctrl Z and Y are bound in the view's
            Scope . An outside reload keeps the stack where its ids still exist and clears it
           otherwise, with a notice.
    5. Layout. layoutPlaces(model, sizes) is the tidy-tree algorithm (Walker, linear time)
           over node sizes. Sizes come from a cache keyed by text, width and font, filled by
           measuring only visible or changed nodes; others are estimated from character count
           until scrolled into view. A 2,000-node layout is pure arithmetic and should take under 10
           ms, so no incremental layout is built. Hand nudges are added to the result and stored in
           the layout block by id.
    6. Drawing. The scene keeps a grid index of node boxes. Each frame draws only boxes
       that meet the viewport plus a margin, reusing DOM elements from a pool; edges are
       one SVG path each, drawn only when an end is visible. Pan and zoom move one parent
           element with a CSS transform, so nothing is laid out while moving. Below 0.4 zoom,
           nodes draw as plain blocks without text. Text in idle nodes goes through
           MarkdownRenderer.render ; the node being edited gets a small CodeMirror 6 editor.

  Also fixed in advance:

           Commands and menus. Each action in 078-actions.js gets on: 'mindmap' ; menus
           come from the same list, as today.
           Events. Edits announce design-redux:mindmap-changed with the path, so panel
           sections and album sync can react without importing the view.
           Renames. A node's [[link]] follows a file rename through the existing design-
           redux:renamed event; the write goes through the normal save path.
           Selection. The selected node is published through plugin.selection (076) so the
           note panel and preview can show it.




                                                                                              Page 17 of 27
Untitled




           Failure. If parsing fails, the view shows the note as text with a banner and a "Report"
           button that copies the line and error; it never writes.


  Build 3: phase by phase
  Each phase is a list of tasks small enough for one session, ending in a "done when" that is a
  test, not a feeling. A task that cannot be finished in a session is split before it starts.


  M0: tree core (about 2 sessions)
    1. Check how tests/map.js assigns areas, add tree below canvas and mindmap
           beside it, and record layers with node tests/map.js --check --update .
    2. Move layoutPlaces , outlineLayout , orderedBranch , siblingOrder from 325-
           canvas-layouts into 403-tree-layouts , taking sizes as input instead of reading
           cards.
    3. Move tree construction from 316-canvas-tree into 400-tree-model ; canvas builds a
           TreeModel from its arrows and calls tree back.

    4. Add tests/test_tree.js with layout cases copied from the canvas tests.

  Done when: tests/test_canvas.js passes untouched, test_layers.js passes, and
  tree imports nothing above core .


  M1: file and view (about 4 sessions)
    1. 401-tree-outline and 402-tree-json : parse and write both formats; build a corpus
           of 30 maps (hand-written, generated, odd indentation, prose around the list) and test
           byte-stable round trips.
    2. 420-mindmap-feature and 421-mindmap-view with a FileFormat adapter for each
      file kind; register .mindmap and the takeover ( 422 ).
    3. 423-mindmap-scene and 424-mindmap-render : layout, culling, node DOM pool, SVG
      edges, pan, zoom, select.
    4. Fold, unfold, "fold every branch", and the outline pane reading the same model.
    5. Settings mindmapTakeover and mindmapDefaultFormat in DEFAULTS and
           SETTINGS_TABS ; commands "New mind map", "Open as text", "Open as mind map".
    6. One real-Obsidian test: a flagged note opens in the view and "Open as text" returns
       the list.




                                                                                                Page 18 of 27
Untitled




  Done when: the corpus round-trips byte for byte, a 2,000-node map opens and pans
  without dropped frames in a simulation, and the e2e test passes on both Obsidian
  versions.


  M2: editing (about 5 sessions)
    1. 404-tree-ops with an inverse for every operation, fuzzed: random operation
           sequences, then undo all, must give the starting model.
    2. 405-tree-history and the Undo and Redo keys.
    3. 426-mindmap-editor : CodeMirror 6 in the node, Enter and Tab to add, Escape to leave,
           link completion from the vault.
    4. 425-mindmap-input : keyboard map, branch drag with the ghost, drop target, reorder
           by dragging past a sibling.
    5. 427-mindmap-save : debounced write, own-write guard, outside-change reload and
      rebase.
    6. Quick add and paste lines as nodes.
    7. Wire every canvas command id with on: 'mindmap' ; record with node
           tests/test_lifecycle.js --update .

  Done when: the fuzz test passes over 10,000 sequences, an outside edit during typing
  loses nothing, and the e2e tests for Undo and outside edit pass.


  M3: looks (about 5 sessions)
    1. Layouts right, left, both, down, up, outline, radial, and per-branch layout with nudges in
       the layout block.
    2. 428-mindmap-motion glide with a reduced-motion switch; peek on a folded branch.
    3. Cards that grow to fit, title and details, arrow and relation styles.
    4. Legend, depth colouring, colour by attribute, pins, saved views and zoom to branch.
    5. Arrange and align as layout commands.
    6. SETTINGS_MIGRATIONS copying ported canvas* values to mindmap* ; stale keys
      retired.

  Done when: every layout matches the canvas result within 1 px on the shared fixtures,
  and the settings migration test passes from a saved 2.0 data.json .




                                                                                           Page 19 of 27
Untitled




  M4: knowledge (about 5 sessions)
    1. 406-tree-relations : relations with labels and direction; arguments (claim, reason,
           objection, rebuttal, evidence) as node attributes with a summary.
    2. Branch to note and note to branch through plugin.files ; the node becomes a link
       and follows renames.
    3. 407-tree-check and 408-tree-compare ; compare two maps or a map against a
           history snapshot.
    4. Vault map: a command that builds a map file from a folder or tag using libraryIndex ;
       minimap from the scene bounds.
    5. Present: step through branches with focus (2.1 Change 4, basic version).
    6. Album and map sync through the parent property (2.1 Change 5), written with
           plugin.notes.write .

  Done when: the knowledge tests from test_canvas.js have mind-map twins that pass,
  and sync round-trips a 200-note folder without changing a note's other properties.


  M5: convert and parity (about 3 sessions)
    1. Convert canvas to mind map using the canvas tree code and a table that maps
       drNudge , drLayout , drTuck , drMaster , drArrow .
    2. Convert to .mindmap and Convert to note ; Export to canvas .
    3. Fixture test: every canvas fixture converts, lays out in both hosts, and matches within 1
       px.
    4. Write tests/snapshots/parity.json with one entry per canvas module and scenario
           and the test that covers it; a test fails if an entry has none.

  Done when: the parity file has no empty entry and the converter leaves the source
  canvas byte-identical.


  M6: speed (about 2 sessions)
    1. A map generator for 500, 2,000 and 5,000 nodes with realistic text lengths.
    2. Measure the six budgets; add culling, text-free zoom-out and far-branch boxes where
       one fails.
    3. A perf test that prints numbers into CI output and fails above 1.5 times a target; fuzz
       parse and write with random text.

  Done when: all budgets hold on the 2,000-node map on Obsidian 1.7.7 and 1.14.4.



                                                                                           Page 20 of 27
Untitled




  M7: switch over (about 2 sessions)
    1. New maps default to the mind map; a setting keeps canvases.
    2. Settings tab section "Maps" with shared colours and spacing; help text for each
       command.
    3. Remove 340-diagnostics ; list what a later major release could delete and its line
           count.
    4. Cut the beta and read the report from tests/ci.sh before releasing.

  Done when: the parity file is complete, the budgets hold, and a fresh vault gets a working
  map in under a minute.


  E1: views, tasks and notes (about 5 sessions)
    1. 411-tree-progress and task nodes: checkbox, due date, status chip, progress ring,
      "open tasks only".
    2. 410-tree-views and the view switcher: Outline, Kanban, Timeline, Table, each editing
           through the same operations.
    3. Linked-note cards reading noteProps and libraryIndex , refreshed on
           metadataCache changes.
    4. A PanelSection for the selected node, with "Make a note from this node".
    5. Focus and filter: dim by search, tag, status, colour, depth; show to level N; solo a
       branch.

  Done when: dragging a card between Kanban columns changes the node's status
  attribute and nothing else in the file.


  E2: capture and sharing (about 5 sessions)
    1. Map in any note: a mindmap code block processor and ![[Map]] embed, read-only,
           using the same renderer.
    2. Drop a note, an image or clipboard text on a node; paste a subtree between maps with
       new ids.
    3. Templates: a folder setting, "New from template", placeholders {{title}} and
           {{date}} .
    4. 413-tree-import and 414-tree-export : OPML, FreeMind and headings in; OPML,
           PNG, SVG and PDF out.




                                                                                              Page 21 of 27
Untitled




    5. Keyboard map complete, tree roles on nodes, every action in the command palette;
           cross-map links [[Map#^id]] that open focused.

  Done when: a screen reader test walks a map by arrow keys in the simulation, and OPML
  round-trips the fixture maps.


  E3: queries, history and polish (about 5 sessions)
    1. 412-tree-query : a query node with tag, folder, property and links-to clauses; virtual
           children from libraryIndex ; "Freeze" writes them as real children.
    2. Map history: the last N autosaves per map, kept in plugin data under PATH_KEYED , with
       browse, restore and compare.
    3. Present with spotlight and speaker notes taken from node details.
    4. Layouts org chart, fishbone and timeline spine in 403-tree-layouts .
    5. Rich nodes: images, icons, shapes, per-depth themes, a markdown details field.

  Done when: a query node over 500 notes refreshes in under 100 ms after a note changes,
  and history stays under its size cap.


  Tests and performance budgets
  The tree core is pure, so most of the plan is tested without a browser, and the view is held
  to numbers the canvas does not meet today. The budgets are targets to confirm in M6,
  measured on a 2,000-node map.


     Measure                            Target            Why

     Parse and write the file           under 20 ms       Runs on every external change

     Open a map and draw the            under 300 ms      Culling means only visible nodes are
     first screen                                         drawn

     Layout after one edit              under 50 ms       Edits must feel instant

     Fold a branch of 500 nodes         under 50 ms       Canvas takes 91 ms on 1.7.7 and 179 ms
                                                          on 1.14 for 500 cards

     Pan or zoom                        60 frames a       No layout work while panning
                                        second

     Memory above the file              under 30 MB       DOM only for what is on screen




                                                                                             Page 22 of 27
Untitled




           tests/test_tree.js (new, simulation). Round-trip of the file on a corpus of hand-
           written and generated maps, byte for byte; fuzzing with random edits that must keep
           the tree valid; every layout against the canvas's own results (positions within 1 px);
           every tree operation and its undo patch.
           tests/test_mindmap.js (new, jsdom). The view's selection, keys, drag and drop, fold,
           undo, autosave and reload when the file changes underneath it.
           Parity test. Each of the 80 canvas scenarios in test_canvas.js that is ported runs
           again on a mind map and must give the same tree. A scenario with no counterpart is
           listed in the parity matrix with its reason.
           Real Obsidian ( tests/e2e.sh ), about 8. The view takes over a flagged note; "Open as
           text" and back keep edits; an outside edit reloads the map; a backlink and a graph edge
           appear for a [[link]] in a node; Undo after an edit; search finds node text; convert a
           canvas fixture; open a 2,000-node map inside the budget.
           Layers. tests/test_layers.js refuses an import from mindmap into canvas or the
           reverse, and tree importing anything above core .
           Run order. While working, only the touched suites; npm test before a push; e2e only
           for what a simulation cannot show, as AGENTS.md says.


  Prompts for Claude Code
  Paste one prompt per session, in order; each ends at a gate and a short report. All of them
  assume the rules in AGENTS.md (smallest complete change, light testing, no version edits,
  command ids and setting keys kept).


  M0: pull the tree out

     Read docs/architecture.md and .claude/rules/canvas.md. Create src/tree/ as a
     new area below canvas and add it to AREAS in tests/map.js. Move the pure
     parts of src/canvas/325-canvas-layouts.js (layoutPlaces, outlineLayout,
     orderedBranch, siblingOrder) and the tree-building logic from 316 into
     src/tree/ as a TreeModel with no DOM and no Obsidian imports. Canvas imports
     them back. Do not change behaviour: tests/test_canvas.js must pass untouched.
     Run node tests/map.js --check --update and npm test. Report files moved and
     test results.




                                                                                             Page 23 of 27
Untitled




  M1: the file and a read-only view

     Add src/tree/ parse and write for the mind-map markdown grammar in the plan
     (nested list, ^ids, trailing %%{}%% attributes, Free nodes and Relations
     sections, design-redux-layout block). Write tests/test_tree.js with a round-
     trip corpus that must be byte-stable. Then add src/mindmap/ with a
     MindMapView (ItemView over a file) that takes over notes with mindmap: true,
     draws nodes as DOM and edges as one SVG layer, supports pan, zoom, select and
     fold, and a Open as text command. Read-only: no editing yet. Add settings
     mindmapTakeover with DEFAULTS and SETTINGS_TABS. Test with
     tests/test_mindmap.js and one real-Obsidian test via tests/e2e.sh.



  M2: editing

     In src/tree/ add edit operations (add child or sibling, delete, move, indent,
     promote, reorder, set text, set attribute), each returning an undo patch. In
     the view add a CodeMirror 6 card editor, Tab and Enter adding, paste lines as
     nodes, branch drag with the ghost, an Undo stack, debounced vault.modify
     saves, and reload on outside change that keeps the selection. Port the canvas
     actions with on: mindmap beside on: canvas in 078-actions.js, keeping every
     command id. Add fuzz tests for the tree and e2e tests for outside edits and
     Undo.



  M3: looks

     Port layouts (right, left, both, down, outline), tidy on every change, glide
     motion with reduced-motion off switch, peek, cards that grow to fit with
     title and details, arrow styles, legend, depth colouring, saved views and
     zoom to branch, pins, arrange and align as layout commands. Copy each ported
     canvas* setting to a mindmap* twin with a SETTINGS_MIGRATIONS step. Update
     tests/snapshots with node tests/test_lifecycle.js --update. Check positions
     against the canvas results within 1 px.



  M4: knowledge

     Port relations, arguments, branch to note and note to branch, check, compare,
     vault map and minimap. Build the 2.1 Change 4 (present a map) and Change 5
     (album and map sync through the parent property) on the new view instead of
     the canvas. Use plugin.notes.write for properties and libraryIndex for vault
     reads. Add the matching simulation tests.




                                                                                 Page 24 of 27
Untitled




  M5: converter and parity

     Add Convert canvas to mind map and Export mind map to canvas, PNG, SVG and
     PDF. Convert every canvas fixture in tests, lay out in both hosts and compare
     positions within 1 px. Write the parity matrix as
     tests/snapshots/parity.json: each of the 35 canvas modules and 80 canvas
     scenarios marked ported, automatic, replaced or not needed, with the test
     that proves it.



  M6: performance

     Build a 2,000-node map generator. Measure parse and write, first draw, layout
     after an edit, fold of 500 nodes, pan and memory against the budgets in the
     plan. Add culling and far-branch collapsing where a budget fails. Add a perf
     test that records the numbers in CI output and fails above 1.5 times the
     target.



  M7: switch over

     Make new maps mind maps by default with a setting for canvases, update the
     settings tab and in-app help, and remove the 340 diagnostics module. Do not
     remove the canvas features yet. Report what a later major release could
     delete and how many lines that is.




  Decisions for you
  Five choices change the work, and each has a default I would take.


     Decision         Default                               Other option and its cost

     File format      Markdown note with a nested list:     Offer a .mindmap JSON file as well
                      indexed, searchable, diffable         (added above): same tree, no
                                                            takeover, simpler parsing, but
                                                            Obsidian does not index it, so no
                                                            backlinks or graph

     Fate of canvas   Keep through 2.x, retire in a later   Remove at 3.0 with the converter
     maps             major release                         only: saves the 35 modules sooner,
                                                            but risks maps people still use




                                                                                          Page 25 of 27
Untitled




     Decision          Default                                 Other option and its cost

     Card editor       Small CodeMirror 6 editor in the        Edit through a plain textarea:
                       node                                    faster to build, loses live preview
                                                               and link completion

     Opening a map     Takeover of flagged notes, with         A separate file extension: no
                       "Open as text"                          takeover to break, but maps stop
                                                               being ordinary notes

     2.1 Changes 4     Rebuild on the new view at M4           Ship them on the canvas first:
     and 5                                                     earlier, then redone once




  Risks and fallbacks
  The two risks that could sink the plan are the view takeover and the card editor, and both
  are tried in the first two phases.


     Risk                          What happens                  Fallback

     Takeover breaks on an         Flagged notes open as         The mindmapTakeover setting
     Obsidian update               text                          and an "Open mind map" button;
                                                                 real-Obsidian test on the oldest
                                                                 and latest versions catches it in
                                                                 CI

     Card editing feels worse      Users avoid editing in        Edit the note panel's text
     than the native editor        the map                       instead; keep the editor to one
                                                                 line plus a details pane until it is
                                                                 good

     DOM is slow past a few        Pan and fold stutter          Cull to the screen; draw far-away
     thousand nodes                                              branches as one box; M6 gate
                                                                 fails the release

     Markdown grammar round-       A map gets noise in diffs     Write only changed lines; byte-
     trip changes a user's text    or Sync conflicts             for-byte test on a corpus; keep
                                                                 the layout block last and optional

     Two hosts to maintain         Fixes land twice              Logic lives in tree/ ; hosts only
                                                                 draw and read input; the canvas
                                                                 gets no new features after M2




                                                                                                 Page 26 of 27
Untitled




     Risk                       What happens                Fallback

     Scope: about 28 sessions   The plan stalls half done   Each phase ships on its own
                                                            behind a setting, and the canvas
                                                            keeps working throughout

     People lose canvas-only    Complaints at switch-       The converter and canvas export
     tools                      over                        stay; the retire step waits for the
                                                            parity matrix




                                                                                          Page 27 of 27
