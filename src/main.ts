import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TFile, TFolder } from 'obsidian';
import { NavigatorView, NAVIGATOR_VIEW_TYPE } from './navigator-view';
import { VaultObserver } from './vault-observer';
import './styles.css';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
	folderContainerWidth: number;
	hiddenFolders: string[];
	hiddenFiles: string[];
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	folderContainerWidth: 300,
	hiddenFolders: [],
	hiddenFiles: []
}

class FolderSuggestModal extends SuggestModal<TFolder> {
	private plugin: MyPlugin;
	private onSelect: (folder: TFolder) => void;
	private suggestionCache: Map<string, TFolder[]> = new Map();
	private debounceTimer: NodeJS.Timeout | null = null;

	constructor(app: App, plugin: MyPlugin, onSelect: (folder: TFolder) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
		this.setPlaceholder('Type to search for folders...');
	}

	getSuggestions(query: string): TFolder[] {
		// Check cache first
		const cacheKey = query.toLowerCase();
		if (this.suggestionCache.has(cacheKey)) {
			return this.suggestionCache.get(cacheKey)!;
		}
		
		// Use cached folders for better performance
		const folders = this.plugin.getCachedFolders();
		const queryLower = cacheKey; // Already lowercased
		
		// Filter with optimized lookups - limit to 50 results for performance
		const results: TFolder[] = [];
		for (const folder of folders) {
			if (results.length >= 50) break; // Early termination
			
			const matchesQuery = query === '' || folder.path.toLowerCase().includes(queryLower);
			const notAlreadyHidden = !this.plugin.isPathHidden(folder.path, 'folder');
			
			if (matchesQuery && notAlreadyHidden) {
				results.push(folder);
			}
		}
		
		// Cache results (max 20 cached queries to prevent memory bloat)
		if (this.suggestionCache.size >= 20) {
			const firstKey = this.suggestionCache.keys().next().value;
			this.suggestionCache.delete(firstKey);
		}
		this.suggestionCache.set(cacheKey, results);
		
		return results;
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		const div = el.createDiv({ cls: 'folder-suggestion' });
		div.createDiv({ cls: 'folder-suggestion-title', text: folder.name });
		if (folder.path) {
			div.createDiv({ cls: 'folder-suggestion-path', text: folder.path });
		} else {
			div.createDiv({ cls: 'folder-suggestion-path', text: 'Root folder' });
		}
	}

	onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
		this.onSelect(folder);
	}
}

class FileSuggestModal extends SuggestModal<TFile> {
	private plugin: MyPlugin;
	private onSelect: (file: TFile) => void;
	private suggestionCache: Map<string, TFile[]> = new Map();

	constructor(app: App, plugin: MyPlugin, onSelect: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
		this.setPlaceholder('Type to search for files...');
	}

	getSuggestions(query: string): TFile[] {
		// Check cache first
		const cacheKey = query.toLowerCase();
		if (this.suggestionCache.has(cacheKey)) {
			return this.suggestionCache.get(cacheKey)!;
		}
		
		// Use cached files for better performance
		const files = this.plugin.getCachedFiles();
		const queryLower = cacheKey; // Already lowercased
		
		// Filter with optimized lookups - limit to 50 results for performance
		const results: TFile[] = [];
		for (const file of files) {
			if (results.length >= 50) break; // Early termination
			
			const matchesQuery = query === '' || 
				file.path.toLowerCase().includes(queryLower) || 
				file.basename.toLowerCase().includes(queryLower);
			const notAlreadyHidden = !this.plugin.isPathHidden(file.path, 'file');
			
			if (matchesQuery && notAlreadyHidden) {
				results.push(file);
			}
		}
		
		// Cache results (max 20 cached queries to prevent memory bloat)
		if (this.suggestionCache.size >= 20) {
			const firstKey = this.suggestionCache.keys().next().value;
			this.suggestionCache.delete(firstKey);
		}
		this.suggestionCache.set(cacheKey, results);
		
		return results;
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		const div = el.createDiv({ cls: 'file-suggestion' });
		div.createDiv({ cls: 'file-suggestion-title', text: file.basename });
		div.createDiv({ cls: 'file-suggestion-path', text: file.path });
	}

	onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
		this.onSelect(file);
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	
	// Performance optimization: Use Sets for O(1) lookups
	private hiddenFoldersSet: Set<string> = new Set();
	private hiddenFilesSet: Set<string> = new Set();
	
	// Caching for suggestion performance
	private folderCache: TFolder[] | null = null;
	private fileCache: TFile[] | null = null;
	private cacheValidUntil: number = 0;

	async onload() {
		await this.loadSettings();

		// Initialize VaultObserver singleton
		VaultObserver.getInstance(this.app);

		// Register the navigator view
		this.registerView(
			NAVIGATOR_VIEW_TYPE,
			(leaf) => new NavigatorView(leaf, this)
		);

		// Open navigator view in left sidebar if not already present
		this.initializeNavigatorView();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {
		// Clean up VaultObserver singleton
		VaultObserver.cleanup();
		
		// Clear performance optimization caches and Sets
		this.hiddenFoldersSet.clear();
		this.hiddenFilesSet.clear();
		this.folderCache = null;
		this.fileCache = null;
		this.cacheValidUntil = 0;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Populate Sets for fast lookups
		this.updateHiddenSets();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update Sets after saving
		this.updateHiddenSets();
		// Invalidate caches
		this.invalidateCache();
	}
	
	private updateHiddenSets(): void {
		this.hiddenFoldersSet.clear();
		this.hiddenFilesSet.clear();
		
		this.settings.hiddenFolders.forEach(path => this.hiddenFoldersSet.add(path));
		this.settings.hiddenFiles.forEach(path => this.hiddenFilesSet.add(path));
	}
	
	private invalidateCache(): void {
		this.folderCache = null;
		this.fileCache = null;
		this.cacheValidUntil = 0;
	}
	
	// Fast O(1) lookup methods
	isPathHidden(path: string, type: 'folder' | 'file'): boolean {
		return type === 'folder' ? this.hiddenFoldersSet.has(path) : this.hiddenFilesSet.has(path);
	}
	
	// Add/remove items with Set updates
	addHiddenPath(path: string, type: 'folder' | 'file'): void {
		if (type === 'folder') {
			if (!this.hiddenFoldersSet.has(path)) {
				this.settings.hiddenFolders.push(path);
				this.hiddenFoldersSet.add(path);
			}
		} else {
			if (!this.hiddenFilesSet.has(path)) {
				this.settings.hiddenFiles.push(path);
				this.hiddenFilesSet.add(path);
			}
		}
	}
	
	removeHiddenPath(path: string, type: 'folder' | 'file'): void {
		if (type === 'folder') {
			const index = this.settings.hiddenFolders.indexOf(path);
			if (index > -1) {
				this.settings.hiddenFolders.splice(index, 1);
				this.hiddenFoldersSet.delete(path);
			}
		} else {
			const index = this.settings.hiddenFiles.indexOf(path);
			if (index > -1) {
				this.settings.hiddenFiles.splice(index, 1);
				this.hiddenFilesSet.delete(path);
			}
		}
	}
	
	// Cached folder/file retrieval with TTL (1 second)
	getCachedFolders(): TFolder[] {
		const now = Date.now();
		if (this.folderCache && now < this.cacheValidUntil) {
			return this.folderCache;
		}
		
		// Rebuild cache
		const folders: TFolder[] = [];
		const rootFolder = this.app.vault.getRoot();
		folders.push(rootFolder);
		
		const getAllFolders = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					folders.push(child);
					getAllFolders(child);
				}
			}
		};
		
		getAllFolders(rootFolder);
		
		this.folderCache = folders;
		this.cacheValidUntil = now + 1000; // 1 second TTL
		return folders;
	}
	
	getCachedFiles(): TFile[] {
		const now = Date.now();
		if (this.fileCache && now < this.cacheValidUntil) {
			return this.fileCache;
		}
		
		// Rebuild cache
		this.fileCache = this.app.vault.getFiles();
		this.cacheValidUntil = now + 1000; // 1 second TTL
		return this.fileCache;
	}

	private async initializeNavigatorView(): Promise<void> {
		// Check if navigator view already exists
		const existingLeaf = this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE)[0];
		if (!existingLeaf) {
			// Create navigator view in left sidebar
			const leaf = this.app.workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: NAVIGATOR_VIEW_TYPE, active: false });
			}
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		// Hidden Folders Section
		containerEl.createEl('h3', {text: 'Hidden Folders'});
		
		// Folder suggestion button
		new Setting(containerEl)
			.setName('Hide folder')
			.setDesc('Search and select a folder to hide from the navigator')
			.addButton(button => {
				button.setButtonText('Choose folder to hide')
					.onClick(() => {
						const modal = new FolderSuggestModal(this.app, this.plugin, async (folder) => {
							this.plugin.addHiddenPath(folder.path, 'folder');
							await this.plugin.saveSettings();
							this.display(); // Refresh display
							// Refresh navigator view
							const navigatorView = this.app.workspace.getLeavesOfType('navigator-view')[0]?.view;
							if (navigatorView) {
								(navigatorView as any).refreshView();
							}
						});
						modal.open();
					});
			});

		// List of hidden folders
		if (this.plugin.settings.hiddenFolders.length > 0) {
			const folderListContainer = containerEl.createDiv('hidden-items-list');
			this.plugin.settings.hiddenFolders.forEach((folderPath) => {
				const itemDiv = folderListContainer.createDiv('hidden-item');
				
				// Content container
				const contentDiv = itemDiv.createDiv('hidden-item-content');
				
				// Path display
				const pathEl = contentDiv.createSpan('hidden-item-path');
				pathEl.textContent = folderPath || 'Root';
				pathEl.title = folderPath || 'Root folder'; // Tooltip for full path
				
				// Type indicator
				const typeEl = contentDiv.createSpan('hidden-item-type');
				typeEl.textContent = 'folder';
				
				// Actions container
				const actionsDiv = itemDiv.createDiv('hidden-item-actions');
				const deleteBtn = actionsDiv.createEl('button', {
					cls: 'hidden-item-delete',
					text: '✕'
				});
				deleteBtn.title = 'Remove from hidden folders';
				deleteBtn.addEventListener('click', async () => {
					this.plugin.removeHiddenPath(folderPath, 'folder');
					await this.plugin.saveSettings();
					this.display(); // Refresh display
					// Refresh navigator view to show unhidden folder
					const navigatorView = this.app.workspace.getLeavesOfType('navigator-view')[0]?.view;
					if (navigatorView) {
						(navigatorView as any).refreshView();
					}
				});
			});
		} else {
			// Empty state for hidden folders
			const emptyState = containerEl.createDiv('hidden-items-empty');
			emptyState.textContent = 'No hidden folders yet. Use the button above to hide folders.';
		}

		// Hidden Files Section
		containerEl.createEl('h3', {text: 'Hidden Files'});
		
		// File suggestion button
		new Setting(containerEl)
			.setName('Hide file')
			.setDesc('Search and select a file to hide from the navigator')
			.addButton(button => {
				button.setButtonText('Choose file to hide')
					.onClick(() => {
						const modal = new FileSuggestModal(this.app, this.plugin, async (file) => {
							this.plugin.addHiddenPath(file.path, 'file');
							await this.plugin.saveSettings();
							this.display(); // Refresh display
						});
						modal.open();
					});
			});

		// List of hidden files
		if (this.plugin.settings.hiddenFiles.length > 0) {
			const fileListContainer = containerEl.createDiv('hidden-items-list');
			this.plugin.settings.hiddenFiles.forEach((filePath) => {
				const itemDiv = fileListContainer.createDiv('hidden-item');
				
				// Content container
				const contentDiv = itemDiv.createDiv('hidden-item-content');
				
				// Path display - show just filename for better readability
				const pathEl = contentDiv.createSpan('hidden-item-path');
				const fileName = filePath.split('/').pop() || filePath;
				pathEl.textContent = fileName;
				pathEl.title = filePath; // Tooltip shows full path
				
				// Type indicator
				const typeEl = contentDiv.createSpan('hidden-item-type');
				typeEl.textContent = 'file';
				
				// Actions container
				const actionsDiv = itemDiv.createDiv('hidden-item-actions');
				const deleteBtn = actionsDiv.createEl('button', {
					cls: 'hidden-item-delete',
					text: '✕'
				});
				deleteBtn.title = 'Remove from hidden files';
				deleteBtn.addEventListener('click', async () => {
					this.plugin.removeHiddenPath(filePath, 'file');
					await this.plugin.saveSettings();
					this.display(); // Refresh display
				});
			});
		} else {
			// Empty state for hidden files
			const emptyState = containerEl.createDiv('hidden-items-empty');
			emptyState.textContent = 'No hidden files yet. Use the button above to hide files.';
		}

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
