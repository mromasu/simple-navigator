# Simple Navigator

A comprehensive file and folder navigation plugin for Obsidian that enhances your vault browsing experience with advanced folder management, file previews, and mobile-optimized navigation.

## Features

### Enhanced Navigation
- **Dual Navigation Views**: Desktop folder tree in sidebar + mobile-optimized touch navigation
- **Hierarchical Folder Tree**: Expandable/collapsible folders with file counts
- **File Container Panel**: Extended sidebar showing file contents with previews
- **Breadcrumb Paths**: Smart location indicators with intelligent truncation

### Advanced File Management
- **Pin/Hide System**: Pin important folders/files to top or hide clutter completely
- **Context Menu Operations**: Right-click to create, rename, delete files/folders
- **Quick Search Modals**: Fast folder/file finder with intelligent filtering
- **Date-Grouped Lists**: Organize files by Today, Yesterday, and specific dates

### Rich File Previews
- **Content Previews**: Sanitized markdown content without formatting
- **Image Thumbnails**: Automatic extraction from frontmatter, markdown, and HTML
- **Smart Image Sources**: Support for cover, banner, thumbnail fields
- **Performance Optimized**: Caching with retry logic and exponential backoff

### Mobile Experience
- **Touch-Optimized Interface**: Larger touch targets and responsive design  
- **Empty Tab Replacement**: Automatically replaces empty tabs on mobile
- **Folder/File View Switching**: Hierarchical navigation designed for touch
- **Mobile-Specific Styling**: Adaptive UI for different screen sizes

### Performance
- **Intelligent Caching**: 1-second TTL for folder/file data
- **Set-Based Lookups**: O(1) performance for hidden/pinned status
- **Debounced Updates**: Prevents UI thrashing during vault changes
- **Smart DOM Updates**: Efficient rendering without full reloads

## Installation

### From Obsidian Community Plugins
1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "Simple Navigator"
4. Install and enable the plugin

### Manual Installation
1. Download the latest release from GitHub
2. Extract `main.js`, `styles.css`, and `manifest.json` to your vault's `.obsidian/plugins/simple-navigator/` folder
3. Reload Obsidian and enable the plugin in Settings

## Usage

### Desktop Navigation
- The plugin adds a collapsible Navigator view to your left sidebar
- Click folder icons to expand/collapse folder contents
- Right-click folders/files for context menu options (pin, hide, create, rename, delete)
- Use the file container panel to preview file contents and thumbnails

### Mobile Navigation
- Opens automatically when you have empty tabs on mobile devices  
- Navigate through folders by tapping to drill down
- Switch between folder view and file view using the interface
- Optimized for touch interaction with larger targets

### Settings
- Configure hidden and pinned folders/files in the plugin settings
- Use search modals to quickly find and manage large numbers of items
- Customize the navigation behavior to fit your workflow

## Development

### Building
```bash
npm i              # Install dependencies
npm run build      # Build the plugin
npm run version    # Bump version and update manifest
```

### Project Structure
- `src/main.ts` - Main plugin class and entry point
- `src/styles.css` - Plugin styling
- `manifest.json` - Plugin metadata
- `esbuild.config.mjs` - Build configuration

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License.
