'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Menu,
  MarkdownView,
  Notice,
  FuzzySuggestModal,
  TFile,
  TFolder,
  ItemView,
  Modal,
  normalizePath,
  Platform,
  setIcon,
  parseYaml,
  stringifyYaml,
  editorLivePreviewField,
  Scope,
  AbstractInputSuggest,
  MenuItem,
  apiVersion,
} = require('obsidian');
// Provided by Obsidian at runtime, as 'obsidian' is.
const { Decoration, EditorView, ViewPlugin, keymap } = require('@codemirror/view');
const { EditorSelection, Prec, RangeSetBuilder } = require('@codemirror/state');
const { syntaxTree } = require('@codemirror/language');

