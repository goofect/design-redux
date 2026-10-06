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
  editorInfoField,
  Scope,
  AbstractInputSuggest,
  EditorSuggest,
  MenuItem,
  MarkdownRenderer,
  Component,
  apiVersion,
} = require('obsidian');
// Provided by Obsidian at runtime, as 'obsidian' is.
const { Decoration, EditorView, ViewPlugin, WidgetType, keymap } = require('@codemirror/view');
const { EditorSelection, Prec, RangeSetBuilder, StateField } = require('@codemirror/state');
const { syntaxTree } = require('@codemirror/language');

