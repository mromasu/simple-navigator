# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin called "Simple Navigator" built with TypeScript. It's based on the official Obsidian sample plugin template and demonstrates core plugin functionality including ribbon icons, commands, modals, and settings.

## Development Commands

- NEVER run `npm run dev`. NEVER!
- `npm run build` - Use this to test code 
- `npm run version` - Bump version and update manifest/versions files

## Architecture

- **Entry point**: `src/main.ts` - Contains the main plugin class `MyPlugin`
- **Build system**: esbuild via `esbuild.config.mjs` - Bundles TypeScript to `main.js`
- **Styling**: `src/styles.css` - Imported directly into main.ts
- **Configuration**: `manifest.json` - Plugin metadata for Obsidian

## Core Plugin Components

The plugin follows standard Obsidian plugin patterns:

- **Plugin class** (`MyPlugin`): Main plugin lifecycle management
- **Settings interface** (`MyPluginSettings`): Plugin configuration structure
- **Modal class** (`SampleModal`): Example modal implementation
- **Settings tab** (`SampleSettingTab`): Plugin settings UI

## Plugin Features

- Ribbon icon with click handler
- Status bar item
- Multiple command types (simple, editor, conditional)
- Settings tab integration
- DOM event registration
- Interval registration with cleanup

## Development Notes

- Plugin loads settings on startup and saves them when changed
- Uses TypeScript with strict null checks enabled
- CSS changes are automatically renamed from `main.css` to `styles.css` during build
- Plugin is installed in `.obsidian/plugins/simple-navigator/` within an Obsidian vault

## Task Management

- Commit progress as last task in todo list

## Documentation Resources

- Use "https://docs.obsidian.md" to get docs for obsidian API and CSS styling variables