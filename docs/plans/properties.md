
  Properties: more functionality
     Oct 18, 2026   · ​@Aidan

  A plan for adding functionality to Design Redux's property tools, built from what the code
  does today.

  Today
  The plugin already edits, reorders, copies and bulk-changes properties well; what it lacks
  is anything that says what a property should be or acts on a change.

     Part                What it does now                          Where

     Note panel          Compact or all view, main properties      160-panel-properties (843
                         first ( panelPrimaryProps ), groups,      lines), 170-panel-native , 180-
                         drag to reorder, sort, add picker, a      panel
                         menu per key with "find entries" and
                         "manage entries"; or Obsidian's own
                         editor borrowed in

     Writing             One path: plugin.notes.write with         073-notes
                         an Undo that keeps what was edited
                         since

     Bulk                Add or remove properties across           301 to 304 in bulk (1,599 lines)
                         folders, folder defaults given to notes
                         made there, rename a property, a
                         value or a tag everywhere, merge
                         properties, change a type, find notes
                         missing a property and fill it, sort
                         properties

     Sets and            Property sets saved by name and           propertySets , 250-property-
     clipboard           applied like a template; copy all or      clipboard
                         some properties and paste with a
                         checklist

Untitled

     Part                   What it does now                         Where

     Browsing               A Properties screen listing each         110 , 255 , 258 , 260
                            property and its values as albums,
                            sorted by name, count or type, in grid
                            or list; an album can be defined by a
                            property; smart albums filter by
                            property; the graph can filter by
                            property

     Reading                Values by name, labels, lists, counts    045-helpers-properties (157
                            across the vault                         lines)

  About 4,500 lines across these modules, all writing through plugin.notes .

  Gaps
  Eight things a person who relies on properties still cannot do, each confirmed against the
  code.

    1. Say what is valid. Folder defaults fill properties when a note is made, and "find missing"
       lists gaps after the fact, but nothing records that notes here must have a status from
       a fixed list.
    2. See messy values. Renaming and merging exist, but nothing finds that "Done", "done "
       and "done." are one value.
    3. Show values meaningfully. A status or priority reads as plain text; there are no colours
       or icons per value.
    4. Act on a change. Moving a note into a folder or setting a tag changes nothing else;
       defaults are given once at creation.
    5. Edit many notes from where you are. Bulk starts from folders or properties, not from
       the notes picked in a list, a search or a smart album.
    6. Look back. Undo covers the last change; there is no record of what a note's status
           was last week.
    7. Work with dates. Date properties are stored and sorted, but there is no "tomorrow", no
       due soon or overdue state, and no album of what is due.
    8. Edit in place. Album rows show values as text and have no write path, so changing one
       means opening the note or the panel.

Untitled

  New functionality
  Fourteen additions in three phases (P1 to P3, about 21 sessions) answer the eight gaps;
  each builds on a service that already exists.

     #     Addition        What it does                     Builds on                   Phase

     1     Schemas         Per folder or album kind:        folderDefaults , find-      P1
                           which keys are required,         missing
                           their type, allowed values, a
                           default; the panel marks
                           what is missing or invalid;
                           "Check against schema"
                           lists and fixes

     2     Value cleanup   Finds near-duplicate values      propertyValues , merge      P1
                           (case, spaces, trailing          tools
                           marks, small typos) and
                           proposes merges through
                           the existing rename and
                           merge tools

     3     Value options   Per property, a list of values   propertyValueView , graph   P1
                           with a colour and icon; used     filter
                           by panel chips, album rows,
                           filters and graph colours

     4     Panel           An invalid value shows a         panel section (160)         P1
           validation      mark with the reason and a
                           one-click fix from the
                           schema

     5     Rules           "When a note enters a            design-redux events,        P2
                           folder, gets a tag or a          plugin.notes
                           property becomes X, set
                           these properties"; dry run
                           first, off by default, one
                           step of Undo per run

     6     Bulk from a     Property tools act on the        plugin.selection , bulk     P2
           selection       notes picked in a list, a        modals
                           search, a smart album or a
                           table, not only on folders

Untitled

     #     Addition        What it does                    Builds on                  Phase

     7     Property        Last N changes per note         plugin.notes records       P2
           history         (key, before, after, time); a
                           panel section to look back
                           and restore one value

     8     Dates           Type "tomorrow" or "+2w"        date type, smart albums    P2
                           into a date; due, soon and
                           overdue states on chips; a
                           smart album of what is due

     9     Rollups         Read-only values on an          libraryIndex               P3
                           album: count, how many
                           done, earliest and latest
                           date, shown in the header
                           and as a column

     10    Property        The Properties screen           PropertiesScreen           P3
           inspector       gains, per property: type,
                           uses, notes missing it,
                           distinct and top values, last
                           used, with the fix tools one
                           click away

     11    Edit in place   Click a value in an album       rows (123), plugin.notes   P3
                           row to pick from its options,
                           set a date or tick a
                           checkbox

     12    Link            A picker for link-type          incoming , outgoing        P3
           properties      properties with "create the
                           note"; "referenced by" per
                           key in Relationships

     13    Panel views     Which properties show, in       panelPrimaryProps ,        P3
           per folder      what order and sort,            PATH_KEYED
                           remembered per folder

     14    Table in and    Copy the properties of          clipboard (250)            P3
           out             picked notes as a table;
                           paste a table to update
                           notes by name, with a
                           preview

Untitled

  Rules are the one addition that changes files without a person pressing a button, so they
  ship last in P2, off by default and with a dry run.

  How it fits
  Nothing here needs a new way of writing, reading or showing a property; each addition
  plugs into a place the code already has.

           Writing. Everything goes through plugin.notes.write(file, change, { undo }) ,
           never processFrontMatter directly. Rules and bulk-from-selection collect their
           changes into one Undo step.
           Reading. noteProps(app, file) for one note, libraryIndex(plugin) for the vault;
           the new checks read the index and do not walk the vault.
           Pure logic in core. Four new core modules hold what needs no screen and is easy to
           test: schema checks, rule evaluation, value options, history records. Module numbers
           are labels, so 086 to 089 are free; node tests/map.js --fix-imports writes the
           imports.
           Screens. Schema marks and history are PanelSection s (082) in the note panel; inline
           editing goes in trackRow (123); the inspector extends PropertiesScreen (110); the
           tools stay in the bulk area's property tools menu.
           Settings. New keys in DEFAULTS and SETTINGS_TABS : propertySchemas and
           propertyHistory (both keyed by path, so in PATH_KEYED ), propertyOptions ,
           propertyRules , propertyHistoryLimit , propertyInlineEdit . folderDefaults
           stays and keeps working; a SETTINGS_MIGRATIONS step copies it into
           propertySchemas as defaults only.
           Following renames. The existing design-redux:property-renamed event updates the
           keys inside schemas, options and rules, and Orders.followRename style handling
           moves path-keyed data.
           Obsidian's own types. A property's type is read as it is now; metadataTypeManager is
           touched only behind typeof checks with a fallback, as AGENTS.md requires.
           Safety for rules. A change a rule made does not trigger rules again in the same run; a
           run over more than 200 notes asks first; every run is previewable and undoable.

Untitled

  Build
  The build adds about 12 modules and 3,700 lines (estimates), against 4,500 in the property
  code today, with the logic in four small core modules so it can be tested without a
  screen.

     Module                              What it holds                                    Lines

      core/086-property-schema            schemaFor(folder) , checkNote(schema,           250
                                         props) returning issues, fixFor(issue)

      core/087-property-rules             parseRule , planRules(rules, event,             300
                                         file) returning a change plan with a loop
                                         guard

      core/088-property-options           optionFor(key, value) colour and icon,          250
                                          nearDuplicates(values)

      core/089-property-history           diffProps(before, after) , a capped             200
                                         record store

      core/045 (extended)                 parseDateInput(text, today) ,                   120
                                          dueState(value, today)

      chrome/161-panel-schema             SchemaSection : marks, reasons, fixes           300

      chrome/162-panel-history            HistorySection : look back and restore          250

      bulk/305-bulk-schema               Check against schema, value cleanup              400
                                         dialogs

      bulk/306-bulk-rules                Rules list, dry run, runner on vault events      500

      bulk/307-bulk-selection            Property tools aimed at picked notes; table      400
                                         in and out

      library (new, numbered between     Property inspector, rollups, inline editing in   600
     neighbours)                         rows

     Settings tab                        Rows for each new key, placed by                 150
                                          SETTINGS_TABS

Untitled

  P1: schema and values (about 6 sessions)
    1. 086 and 088 with tests: allowed values, required keys, near-duplicate detection on a
           corpus of messy values.
    2. propertySchemas and propertyOptions in DEFAULTS and SETTINGS_TABS ; the
      migration copying folderDefaults .
    3. SchemaSection in the panel: marks, reason on hover, one-click fix written through
       plugin.notes .
    4. Value chips with colour and icon in the panel, album rows and filters.
    5. "Check against schema" and "Clean up values" in the property tools menu, each ending
       in one Undo step.

  Done when: a folder schema marks a note with a wrong value, the fix puts it right and
  Undo restores it; the cleanup finds "Done", "done " and "done." as one value;
    test_lifecycle.js shows only added keys.

  P2: acting on changes (about 7 sessions)
    1. 089 and propertyHistory : record from plugin.notes writes only, capped per note,
           path-keyed so it follows renames.
    2. HistorySection : browse and restore one value.
    3. Dates: parseDateInput , dueState , due chips, a smart album for what is due.
    4. 307 : property tools take picked notes from plugin.selection , search results and
           smart albums.
    5. 087 and 306 : rules with dry run, preview list, loop guard and the 200-note
      confirmation; run on create , rename and metadata change for the one file concerned.

  Done when: a rule moving a note into a folder sets its status once, does not re-trigger
  itself, and one Undo reverses a run over 50 notes; history keeps the last N changes and
  restores one value without touching the others.

  P3: computing and editing (about 8 sessions)
    1. Rollups for albums: count, done, earliest and latest, in the header and as a column; no
       formulas beyond a fixed set.
    2. Property inspector on the Properties screen.
    3. Inline editing in album rows, using each key's options or type.
    4. Link properties: picker with create, and "referenced by" per key.

Untitled

    5. Panel views per folder; table copy and paste with a preview.

  Done when: a value changed in a row is written and shown without a full redraw of the
  album; the inspector's counts match propertyCounter on the test vault; a pasted table
  changes exactly the cells that differ.

  Tests. New tests/test_schema.js , test_rules.js and test_prophistory.js
  (simulation), additions to test_bulk.js and test_album.js , and one real-Obsidian test
  for rules on a file move, run with tests/e2e.sh on the latest version only.

  Decisions and risks
  Four choices change the work, and each has the default I would take.

     Decision            Default                          Other option and its cost

     Where schemas       In plugin settings, keyed by     In a note inside each folder: travels
     live                folder path                      with the vault and shows in Sync, but a
                                                          visible file per folder

     Rules               Off until switched on, dry run   On from the start: useful at once, but a
                         first                            vault can change before anyone
                                                          expects it

     Property history    Plugin data, last 20 changes     Inside the note: survives a reinstall, but
                         per note                         adds text to every note

     Computed            A fixed set of rollups on        Free-form formulas: powerful, but
     values              albums only                      Obsidian's Bases already covers tables
                                                          and formulas, and an expression
                                                          language is a lot to keep safe

     Risk                           What happens                 Fallback

     A rule loops or rewrites too   Notes change repeatedly      Loop guard, 200-note
     much                           or in bulk                   confirmation, dry run, one Undo
                                                                 step per run, a setting that
                                                                 turns every rule off

Untitled

     Risk                      What happens                Fallback

     Schemas feel strict       Marks everywhere on an      Marks are quiet by default and
                               untidy vault                only for keys marked required;
                                                           a schema can be paused per
                                                           folder

     History grows             Plugin data becomes large   Cap per note and overall; oldest
                                                           dropped first; one clear
                                                           command

     Overlap with Obsidian's   Two places to set a type    Read Obsidian's types and
     own property features     or a list of values         never write them; options here
                                                           are display only

     Sync conflicts from       Two devices apply the       Rules write only when the value
     automatic writes          same rule                   differs, so two devices reach
                                                           the same result and stop; a
                                                           conflict test covers it


