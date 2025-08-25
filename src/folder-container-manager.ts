import { App, TFolder, TFile, TAbstractFile, Vault, Menu, Notice } from 'obsidian';
import { VaultObserver, VaultUpdateHandler } from './vault-observer';
import MyPlugin from './main';
import { NavigatorView, TextInputModal } from './navigator-view';

interface FileItemElements {
	container: HTMLElement;
	content: HTMLElement;
	title: HTMLElement;
	preview: HTMLElement;
	meta?: HTMLElement;
	image: HTMLElement;
	folderBadge?: HTMLElement;
}

interface GroupElements {
	container: HTMLElement;
	header: HTMLElement;
	groupContainer: HTMLElement;
}

export class FolderContainerManager implements VaultUpdateHandler {
	private app: App;
	private plugin: MyPlugin;
	private navigatorView: NavigatorView;
	private container: HTMLElement | null = null;
	private currentFolder: TFolder | null = null;
	private fileElements: Map<string, FileItemElements> = new Map();
	private groupElements: Map<string, GroupElements> = new Map();
	private isAllNotesMode: boolean = false;
	private isCollapsed: boolean = false;
	private retryCount: number = 0;
	private maxRetries: number = 5;
	private baseRetryDelay: number = 1000; // 1 second

	constructor(app: App, plugin: MyPlugin, navigatorView: NavigatorView) {
		this.app = app;
		this.plugin = plugin;
		this.navigatorView = navigatorView;
		this.bindEvents();
	}

	private bindEvents(): void {
		// Only close button closes the container - no ESC key
	}

	private debugLog(message: string, ...args: any[]): void {
		if (this.plugin.settings.debugLogging) {
			console.log(`[Simple Navigator - Container] ${message}`, ...args);
		}
	}

	private getSidebarState(): { leftOpen: boolean; rightOpen: boolean } {
		// Detect sidebar states by checking CSS classes and DOM elements
		const appContainer = document.querySelector('.app-container');
		const leftSidebar = document.querySelector('.mod-left-split');
		const rightSidebar = document.querySelector('.mod-right-split');
		
		const leftOpen = leftSidebar ? !leftSidebar.hasClass('is-collapsed') : false;
		const rightOpen = rightSidebar ? !rightSidebar.hasClass('is-collapsed') : false;
		
		this.debugLog('Sidebar states:', { leftOpen, rightOpen });
		return { leftOpen, rightOpen };
	}

	private logDOMStructure(): void {
		if (!this.plugin.settings.debugLogging) return;
		
		this.debugLog('=== DOM Structure Analysis ===');
		
		// Log app container structure
		const appContainer = document.querySelector('.app-container');
		if (appContainer) {
			this.debugLog('App container found:', appContainer.className);
			this.debugLog('App container children:', Array.from(appContainer.children).map((el, i) => `${i}: ${el.className}`));
		}
		
		// Log sidebar states
		const sidebarState = this.getSidebarState();
		this.debugLog('Sidebar states:', sidebarState);
		
		// Log horizontal main container
		const horizontalMain = document.querySelector('.horizontal-main-container');
		if (horizontalMain) {
			this.debugLog('Horizontal main container:', horizontalMain.className);
			this.debugLog('Horizontal main children:', Array.from(horizontalMain.children).map((el, i) => `${i}: ${el.className}`));
		}
		
		this.debugLog('=== End DOM Structure Analysis ===');
	}

	private findWorkspaceElement(): HTMLElement | null {
		// Log DOM structure and sidebar states for debugging
		this.logDOMStructure();
		
		// Multiple fallback selectors for workspace element detection
		// Order matters - more specific selectors first
		const selectors = [
			'.app-container .horizontal-main-container .workspace',
			'.horizontal-main-container .workspace',
			'.app-container .workspace',
			'.workspace',
			'[data-type="workspace"]',
			'.workspace-split.mod-root'
		];

		this.debugLog('Searching for workspace element with selectors:', selectors);
		
		for (const selector of selectors) {
			const element = document.querySelector(selector) as HTMLElement;
			if (element) {
				this.debugLog(`Found workspace element with selector: ${selector}`);
				this.debugLog('Workspace element classes:', element.className);
				this.debugLog('Workspace element children count:', element.children.length);
				return element;
			}
		}

		// If we still can't find workspace, try waiting for DOM to be ready
		this.debugLog('No workspace element found with standard selectors');
		return null;
	}

	openContainer(folder: TFolder): void;
	openContainer(allNotes: 'ALL_NOTES'): void;
	openContainer(target: TFolder | 'ALL_NOTES'): void {
		// If container already exists, just update it instead of recreating
		if (this.container) {
			// Expand container if it's collapsed when user clicks a folder
			if (this.isCollapsed) {
				this.toggleCollapse();
			}
			// Use setTimeout to avoid blocking the UI
			setTimeout(async () => {
				await this.updateContainer(target);
			}, 0);
			return;
		}

		// No existing container, create new one
		if (target === 'ALL_NOTES') {
			this.isAllNotesMode = true;
			this.currentFolder = this.app.vault.getRoot(); // Use root for file operations
			// Set active folder in navigator
			this.navigatorView.setActiveFolder('ALL_NOTES');
		} else {
			this.isAllNotesMode = false;
			this.currentFolder = target;
			// Set active folder in navigator
			this.navigatorView.setActiveFolder(target.path);
		}
		
		// Use setTimeout to avoid blocking the UI
		setTimeout(async () => {
			await this.createContainer();
		}, 0);
		
		// Register with VaultObserver for file system events
		VaultObserver.getInstance(this.app).registerView(this);
	}

	// Method to initialize container on plugin load
	initializeContainer(): void {
		this.debugLog('FolderContainerManager.initializeContainer called');
		if (!this.container) {
			// Initialize with All Notes by default
			this.openContainer('ALL_NOTES');
		}
	}

	// Method to retry initialization (public for manual retry)
	retryInitialization(): void {
		this.debugLog('Manual retry initialization requested');
		this.retryCount = 0; // Reset retry count for manual retry
		this.closeContainer();
		this.initializeContainer();
	}

	// Check if container exists
	hasContainer(): boolean {
		return this.container !== null;
	}

	closeContainer(): void {
		if (this.container) {
			// Unregister from VaultObserver
			VaultObserver.getInstance(this.app).unregisterView(this);
			
			// Clear active folder in navigator
			this.navigatorView.clearActiveFolder();
			
			this.container.remove();
			this.container = null;
			this.currentFolder = null;
			this.isAllNotesMode = false;
			this.isCollapsed = false;
			
			// Clear element tracking
			this.fileElements.clear();
			this.groupElements.clear();
			this.fileImageCache.clear();
		}
	}

	async toggleCollapse(): Promise<void> {
		if (!this.container) return;
		
		this.isCollapsed = !this.isCollapsed;
		
		// Update button text and tooltip
		const collapseButton = this.container.querySelector('.folder-container-close') as HTMLElement;
		if (collapseButton) {
			collapseButton.innerHTML = '×'; // Close icon
			collapseButton.title = this.isCollapsed ? 'Expand' : 'Collapse';
		}
		
		// Update CSS classes for animation
		if (this.isCollapsed) {
			this.container.removeClass('expanded');
			this.container.addClass('collapsed');
		} else {
			this.container.removeClass('collapsed');
			this.container.addClass('expanded');
		}
		
		// Save state to settings
		this.plugin.settings.folderContainerCollapsed = this.isCollapsed;
		await this.plugin.saveSettings();
	}

	private async createContainer(): Promise<void> {
		if (!this.currentFolder) {
			this.debugLog('createContainer called but currentFolder is null');
			return;
		}

		this.debugLog(`Creating container for ${this.isAllNotesMode ? 'ALL_NOTES' : this.currentFolder.path}, retry count: ${this.retryCount}`);
		
		// Find the workspace element with fallback selectors
		const workspace = this.findWorkspaceElement();
		if (!workspace) {
			this.debugLog('Workspace element not found');
			
			// Implement retry logic with exponential backoff
			if (this.retryCount < this.maxRetries) {
				this.retryCount++;
				const delay = this.baseRetryDelay * Math.pow(2, this.retryCount - 1);
				this.debugLog(`Retrying container creation in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
				
				setTimeout(() => {
					this.createContainer();
				}, delay);
			} else {
				this.debugLog('Max retries exceeded, container creation failed');
				console.error('[Simple Navigator] Failed to find workspace element after maximum retries. Container will not be created.');
			}
			return;
		}

		this.debugLog('Workspace element found, proceeding with container creation');
		this.retryCount = 0; // Reset retry count on successful workspace detection
		
		// Create container element
		this.container = document.createElement('div');
		this.container.addClass('workspace-split', 'mod-horizontal', 'mod-sidedock', 'mod-left-extend');
		
		// Initialize collapsed state from settings
		this.isCollapsed = this.plugin.settings.folderContainerCollapsed;
		
		if (this.isCollapsed) {
			this.container.addClass('collapsed');
		} else {
			this.container.addClass('expanded');
		}

		// Create header
		const header = this.container.createEl('div', { cls: 'folder-container-header' });
		
		// Create collapse button (left side)
		const collapseButton = header.createEl('button', { cls: 'folder-container-close' });
		collapseButton.innerHTML = '×'; // Close icon
		collapseButton.title = this.isCollapsed ? 'Expand' : 'Collapse';
		collapseButton.addEventListener('click', () => this.toggleCollapse());
		
		// Create title (center)
		const title = header.createEl('h2', { cls: 'folder-container-title' });
		
		if (this.isAllNotesMode) {
			title.textContent = 'All Notes';
		} else {
			title.textContent = this.currentFolder.isRoot() ? 'Notes' : this.currentFolder.name;
		}

		// Create new note button (right side)
		const newNoteButton = header.createEl('button', { cls: 'folder-container-new-note' });
		newNoteButton.innerHTML = '+';
		newNoteButton.title = 'Create new note';
		newNoteButton.addEventListener('click', () => this.createNewNote());

		// Create content container
		const content = this.container.createEl('div', { cls: 'folder-container-content' });
		
		// Render file list
		await this.renderFileList(content);


		// Insert as 3rd child in workspace
		const children = Array.from(workspace.children);
		this.debugLog(`Workspace has ${children.length} children:`, children.map(el => el.className));
		
		if (children.length >= 2) {
			this.debugLog('Inserting container as 3rd child');
			workspace.insertBefore(this.container, children[2] || null);
		} else {
			this.debugLog('Appending container to workspace');
			workspace.appendChild(this.container);
		}
		
		this.debugLog('Container successfully created and inserted into DOM');
		this.debugLog('Container classes:', this.container.className);
		this.debugLog('Container width:', this.container.offsetWidth);
		this.debugLog('Container is collapsed:', this.isCollapsed);
	}


	cleanup(): void {
		// Unregister from VaultObserver before closing
		if (this.container) {
			VaultObserver.getInstance(this.app).unregisterView(this);
		}
		// Clear active folder in navigator
		this.navigatorView.clearActiveFolder();
		this.closeContainer();
		// Clear image cache
		this.fileImageCache.clear();
		// Remove event listeners would go here if we had stored references
	}

	private async renderFileList(content: HTMLElement): Promise<void> {
		if (!this.currentFolder) return;

		// Get files based on folder type
		const files = this.getFiles();
		
		// Group files by date
		const groupedFiles = this.groupFilesByDate(files);
		
		// Render each group
		for (const [groupName, groupFiles] of Object.entries(groupedFiles)) {
			if (groupFiles.length === 0) continue;
			
			await this.renderFileGroup(content, groupName, groupFiles);
		}
	}

	private getFiles(): TFile[] {
		if (!this.currentFolder) return [];

		const files: TFile[] = [];

		if (this.isAllNotesMode) {
			// For All Notes mode: get ALL files from entire vault recursively
			Vault.recurseChildren(this.app.vault.getRoot(), (file: TAbstractFile) => {
				if (file instanceof TFile) {
					files.push(file);
				}
			});
		} else if (this.currentFolder.isRoot()) {
			// For root folder: only direct children (no recursion)
			for (const child of this.currentFolder.children) {
				if (child instanceof TFile) {
					files.push(child);
				}
			}
		} else {
			// For sub-folders: get all files recursively
			Vault.recurseChildren(this.currentFolder, (file: TAbstractFile) => {
				if (file instanceof TFile) {
					files.push(file);
				}
			});
		}

		// Filter out hidden files
		const visibleFiles = files.filter(file => !this.isFileHidden(file.path));

		// Sort by creation time (newest first)
		return visibleFiles.sort((a, b) => b.stat.ctime - a.stat.ctime);
	}

	private groupFilesByDate(files: TFile[]): Record<string, TFile[]> {
		const groups: Record<string, TFile[]> = {
			'Pinned': [],
			'Today': [],
			'Yesterday': [],
		};

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

		for (const file of files) {
			// Check if file is pinned first
			if (this.plugin.isPathPinned(file.path, 'file')) {
				groups['Pinned'].push(file);
				continue;
			}

			const fileDate = new Date(file.stat.ctime);
			const fileDateOnly = new Date(fileDate.getFullYear(), fileDate.getMonth(), fileDate.getDate());

			if (fileDateOnly.getTime() === today.getTime()) {
				groups['Today'].push(file);
			} else if (fileDateOnly.getTime() === yesterday.getTime()) {
				groups['Yesterday'].push(file);
			} else {
				const groupKey = this.formatDateGroup(fileDate);
				if (!groups[groupKey]) {
					groups[groupKey] = [];
				}
				groups[groupKey].push(file);
			}
		}

		return groups;
	}

	private formatDateGroup(date: Date): string {
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
			'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		
		const day = date.getDate();
		const month = months[date.getMonth()];
		const year = date.getFullYear();
		const currentYear = new Date().getFullYear();
		
		if (year === currentYear) {
			return `${day} ${month}`;
		} else {
			return `${day} ${month} ${year}`;
		}
	}

	private async renderFileGroup(content: HTMLElement, groupName: string, files: TFile[]): Promise<void> {
		const group = content.createEl('div', { cls: 'file-list-group' });
		
		// Group header
		const header = group.createEl('h3', { cls: 'file-list-group-header' });
		if (groupName === 'Pinned') {
			header.addClass('pinned-header');
		}
		header.textContent = groupName;
		
		// Group container
		const container = group.createEl('div', { cls: 'file-list-group-container' });
		
		// Store group element references
		this.groupElements.set(groupName, {
			container: group,
			header: header,
			groupContainer: container
		});
		
		// File items
		for (let i = 0; i < files.length; i++) {
			await this.renderFileItem(container, files[i]);
			
			// Add divider after each item except the last
			if (i < files.length - 1) {
				container.createEl('div', { cls: 'file-item-divider' });
			}
		}
	}

	private async renderFileItem(container: HTMLElement, file: TFile): Promise<void> {
		const item = container.createEl('div', { cls: 'file-item' });
		
		// Add pinned class if file is pinned
		if (this.plugin.isPathPinned(file.path, 'file')) {
			item.addClass('pinned');
		}
		
		// Item content (left side)
		const itemContent = item.createEl('div', { cls: 'file-item-content' });
		
		// File name
		const fileName = itemContent.createEl('div', { cls: 'file-item-title' });
		fileName.textContent = file.basename;
		
		// File preview
		const preview = itemContent.createEl('div', { cls: 'file-item-preview' });
		
		// Item metadata (only create when there's content to show)
		let meta: HTMLElement | undefined;
		let folderBadge: HTMLElement | undefined;
		
		// Folder badge (if not in root and not in current folder for folder views)
		const shouldShowFolderBadge = (this.isAllNotesMode || !this.currentFolder?.isRoot()) &&
			!file.parent?.isRoot() && 
			(this.isAllNotesMode || file.parent !== this.currentFolder);
		
		if (shouldShowFolderBadge) {
			meta = itemContent.createEl('div', { cls: 'file-item-meta' });
			folderBadge = meta.createEl('span', { cls: 'file-item-folder' });
			folderBadge.innerHTML = `📁 ${file.parent?.name || 'Notes'}`;
		}
		
		// Image container (right side)
		const imageContainer = item.createEl('div', { cls: 'file-item-image' });
		
		// Add folder attribute to container
		let folderName: string;
		if (this.isAllNotesMode) {
			folderName = 'All Notes';
		} else if (this.currentFolder?.isRoot()) {
			folderName = 'Notes';
		} else {
			folderName = this.currentFolder?.name || 'Notes';
		}
		item.setAttribute('folder', folderName);
		
		// Store file element references
		this.fileElements.set(file.path, {
			container: item,
			content: itemContent,
			title: fileName,
			preview: preview,
			meta: meta,
			image: imageContainer,
			folderBadge: folderBadge
		});
		
		// Click handler
		item.addEventListener('click', () => {
			this.app.workspace.openLinkText(file.path, '', false);
		});

		// Context menu handler
		item.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFileContextMenu(e, file);
		});
		
		// Load content and image with proper coordination
		await this.loadFileContent(file, preview, imageContainer);
	}

	private fileImageCache: Map<string, string | null> = new Map();

	// New unified method to load both preview and image with proper coordination
	private async loadFileContent(file: TFile, previewElement: HTMLElement, imageElement: HTMLElement): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			
			// Extract first image and cache it
			const firstImage = this.extractFirstImage(content);
			this.fileImageCache.set(file.path, firstImage);
			
			// Set text preview
			const preview = this.sanitizeContent(content);
			previewElement.textContent = preview || 'No preview available';
			
			// Load image with retry logic if image path found
			if (firstImage) {
				// Clear any existing CSS classes
				imageElement.removeClass('loading', 'error', 'retry');
				await this.setImagePreviewWithRetry(imageElement, file, firstImage);
			} else {
				// No image found, clean up and hide the image container
				imageElement.removeClass('loading', 'error', 'retry');
				imageElement.style.display = 'none';
			}
		} catch (error) {
			console.log('File content loading error:', error);
			this.fileImageCache.set(file.path, null);
			previewElement.textContent = 'No preview available';
			imageElement.style.display = 'none';
		}
	}

	private async setFilePreview(element: HTMLElement, file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			
			// Extract first image and cache it
			const firstImage = this.extractFirstImage(content);
			this.fileImageCache.set(file.path, firstImage);
			
			// Generate text preview
			const preview = this.sanitizeContent(content);
			element.textContent = preview || 'No preview available';
		} catch {
			this.fileImageCache.set(file.path, null);
			element.textContent = 'No preview available';
		}
	}

	// Image preview with retry logic and exponential backoff
	private async setImagePreviewWithRetry(element: HTMLElement, file: TFile, imagePath: string, attempt: number = 1): Promise<void> {
		const MAX_RETRIES = 3;
		const BASE_DELAY = 100; // Start with 100ms delay
		
		try {
			// Show the image container and set loading state
			element.style.display = 'block';
			element.addClass('loading');
			
			// Resolve the image path
			let resolvedPath: string;
			
			if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
				// External URL
				resolvedPath = imagePath;
			} else if (imagePath.startsWith('/')) {
				// Absolute path (probably external)
				resolvedPath = imagePath;
			} else {
				// Relative path or vault file - try multiple resolution strategies
				let imageFile: TFile | null = null;
				
				// Try direct path
				const directFile = this.app.vault.getAbstractFileByPath(imagePath);
				if (directFile instanceof TFile) {
					imageFile = directFile;
				} else if (file.parent) {
					// Try relative to the note's folder
					const relativeFile = this.app.vault.getAbstractFileByPath(`${file.parent.path}/${imagePath}`);
					if (relativeFile instanceof TFile) {
						imageFile = relativeFile;
					}
				}
				
				// If still not found, try finding by filename in the vault
				if (!imageFile) {
					const allFiles = this.app.vault.getFiles();
					imageFile = allFiles.find(f => f.name === imagePath || f.path.endsWith(`/${imagePath}`)) || null;
				}
				
				if (imageFile) {
					// Use Obsidian's resource URL with error checking
					try {
						resolvedPath = this.app.vault.getResourcePath(imageFile);
						if (!resolvedPath) {
							throw new Error('Resource path returned null');
						}
					} catch (resourceError) {
						console.log(`Image resource path error (attempt ${attempt}):`, resourceError);
						throw resourceError;
					}
				} else {
					// No image file found
					element.style.display = 'none';
					element.removeClass('loading');
					return;
				}
			}
			
			// Create and set up the image element
			element.empty();
			const img = element.createEl('img');
			img.style.width = '100%';
			img.style.height = '100%';
			img.style.objectFit = 'cover';
			img.style.borderRadius = '4px';
			
			// Promise-based image loading with timeout
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Image load timeout'));
				}, 5000); // 5 second timeout
				
				img.onload = () => {
					clearTimeout(timeout);
					element.removeClass('loading');
					resolve();
				};
				
				img.onerror = (error) => {
					clearTimeout(timeout);
					reject(new Error(`Image load failed: ${error}`));
				};
				
				img.src = resolvedPath;
			});
			
		} catch (error) {
			console.log(`Image preview error (attempt ${attempt}/${MAX_RETRIES}):`, error);
			element.removeClass('loading');
			
			// Retry with exponential backoff if we haven't exceeded max retries
			if (attempt < MAX_RETRIES) {
				const delay = BASE_DELAY * Math.pow(2, attempt - 1); // 100ms, 200ms, 400ms
				console.log(`Retrying image load in ${delay}ms...`);
				
				// Show retry state
				element.addClass('retry');
				
				setTimeout(() => {
					element.removeClass('retry');
					this.setImagePreviewWithRetry(element, file, imagePath, attempt + 1);
				}, delay);
			} else {
				// Max retries exceeded, show error state briefly then hide
				console.log('Max retries exceeded, showing error state');
				element.addClass('error');
				
				setTimeout(() => {
					element.removeClass('error');
					element.style.display = 'none';
				}, 2000); // Show error for 2 seconds
			}
		}
	}

	private async setImagePreview(element: HTMLElement, file: TFile): Promise<void> {
		const imagePath = this.fileImageCache.get(file.path);
		
		if (!imagePath) {
			// No image found, hide the image container
			element.style.display = 'none';
			return;
		}
		
		await this.setImagePreviewWithRetry(element, file, imagePath);
	}

	private isValidImageUrl(url: string): boolean {
		const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico'];
		const urlLower = url.toLowerCase();
		return imageExtensions.some(ext => urlLower.endsWith(ext));
	}

	private extractFrontmatterImage(content: string): string | null {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) return null;
		
		const frontmatterContent = frontmatterMatch[1];
		const frontmatterFields = ['cover', 'banner', 'thumbnail', 'featured-image', 'image', 'preview'];
		
		for (const field of frontmatterFields) {
			const fieldRegex = new RegExp(`^${field}:\\s*(.+)$`, 'm');
			const match = frontmatterContent.match(fieldRegex);
			if (match) {
				const imageUrl = match[1].trim().replace(/['"]/g, '');
				if (this.isValidImageUrl(imageUrl)) {
					return imageUrl;
				}
			}
		}
		
		return null;
	}

	private extractFirstImage(content: string): string | null {
		// First check for frontmatter images
		const frontmatterImage = this.extractFrontmatterImage(content);
		if (frontmatterImage) {
			return frontmatterImage;
		}

		// Remove YAML frontmatter for content search
		const withoutFrontmatter = content.replace(/^---[\s\S]*?---\n?/m, '');
		
		// Pattern for Markdown images: ![alt](path)
		const markdownImageMatch = withoutFrontmatter.match(/!\[([^\]]*)\]\(([^)]+)\)/);
		if (markdownImageMatch) {
			return markdownImageMatch[2]; // Return the path
		}
		
		// Pattern for Obsidian wikilink images: ![[image.png]] or ![[image.png|alt]]
		const wikiImageMatch = withoutFrontmatter.match(/!\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/);
		if (wikiImageMatch) {
			return wikiImageMatch[1]; // Return the filename/path
		}
		
		// Pattern for HTML images: <img src="path">
		const htmlImageMatch = withoutFrontmatter.match(/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i);
		if (htmlImageMatch) {
			return htmlImageMatch[1]; // Return the src path
		}
		
		return null;
	}

	private sanitizeContent(content: string): string {
		let sanitized = content;

		// Remove YAML frontmatter
		sanitized = sanitized.replace(/^---[\s\S]*?---\n?/m, '');

		// Remove HTML tags
		sanitized = sanitized.replace(/<[^>]*>/g, '');

		// Remove headings
		sanitized = sanitized.replace(/^#{1,6}\s+.*$/gm, '');

		// Remove code blocks
		sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
		sanitized = sanitized.replace(/`[^`]*`/g, '');

		// Remove links and references
		sanitized = sanitized.replace(/!\[\[.*?\]\]/g, ''); // Wiki image links (with !)
		sanitized = sanitized.replace(/\[\[.*?\]\]/g, ''); // Wiki links (no !)
		sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]*\)/g, ''); // Markdown images (with !)
		sanitized = sanitized.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // Markdown links (no !)

		// Remove emphasis and formatting
		sanitized = sanitized.replace(/\*\*([^*]*)\*\*/g, '$1'); // Bold
		sanitized = sanitized.replace(/\*([^*]*)\*/g, '$1'); // Italic
		sanitized = sanitized.replace(/__([^_]*)__/g, '$1'); // Bold underscore
		sanitized = sanitized.replace(/_([^_]*)_/g, '$1'); // Italic underscore
		sanitized = sanitized.replace(/~~([^~]*)~~/g, '$1'); // Strikethrough

		// Remove list markers
		sanitized = sanitized.replace(/^[\s]*[-*+]\s+/gm, '');
		sanitized = sanitized.replace(/^[\s]*\d+\.\s+/gm, '');

		// Remove blockquotes
		sanitized = sanitized.replace(/^>\s*/gm, '');

		// Remove arrows and connectors
		sanitized = sanitized.replace(/-{2,}>/g, ''); // ---> arrows
		sanitized = sanitized.replace(/->/g, ''); // -> arrows
		sanitized = sanitized.replace(/<-+/g, ''); // <-- arrows
		sanitized = sanitized.replace(/={2,}>/g, ''); // ===> arrows
		sanitized = sanitized.replace(/=>/g, ''); // => arrows

		// Remove horizontal rules and dividers
		sanitized = sanitized.replace(/^-{3,}$/gm, ''); // --- dividers
		sanitized = sanitized.replace(/^={3,}$/gm, ''); // === dividers
		sanitized = sanitized.replace(/^\*{3,}$/gm, ''); // *** dividers
		sanitized = sanitized.replace(/^_{3,}$/gm, ''); // ___ dividers

		// Remove tables (basic cleanup)
		sanitized = sanitized.replace(/\|/g, ' ');

		// Clean up extra whitespace
		sanitized = sanitized.replace(/\n\s*\n/g, ' '); // Multiple newlines
		sanitized = sanitized.replace(/\s+/g, ' '); // Multiple spaces
		sanitized = sanitized.trim();

		// Return first 100 characters
		return sanitized.substring(0, 100);
	}

	private formatFileTime(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const fileDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		
		if (fileDate.getTime() === today.getTime()) {
			// Today: show time like "3:12 PM"
			return date.toLocaleTimeString('en-US', { 
				hour: 'numeric', 
				minute: '2-digit',
				hour12: true 
			});
		} else if (fileDate.getTime() === today.getTime() - 24 * 60 * 60 * 1000) {
			// Yesterday: show "Yesterday"
			return 'Yesterday';
		} else {
			// Older: show date like "10/1/24"
			return date.toLocaleDateString('en-US', { 
				month: 'numeric', 
				day: 'numeric', 
				year: '2-digit' 
			});
		}
	}


	private isFileInCurrentFolder(file: TAbstractFile): boolean {
		if (!this.currentFolder) return false;
		
		console.log('[DELETE DEBUG] isFileInCurrentFolder check', {
			filePath: file.path,
			currentFolderPath: this.currentFolder.path,
			fileParent: file.parent?.path || 'null',
			isAllNotesMode: this.isAllNotesMode,
			isRootFolder: this.currentFolder.isRoot()
		});
		
		if (this.isAllNotesMode) {
			// For All Notes mode: all files in vault are relevant
			return true;
		} else if (this.currentFolder.isRoot()) {
			// For root folder: check all files in vault
			return true;
		} else {
			// For specific folder: check if file is in this folder or its children
			// For deleted files, we need to check by path since parent might be null
			if (file.path.startsWith(this.currentFolder.path + '/')) {
				console.log('[DELETE DEBUG] File is in current folder (by path check)');
				return true;
			}
			
			// Fallback to parent traversal for non-deleted files
			let current = file.parent;
			while (current) {
				if (current === this.currentFolder) {
					console.log('[DELETE DEBUG] File is in current folder (by parent traversal)');
					return true;
				}
				current = current.parent;
			}
			console.log('[DELETE DEBUG] File is NOT in current folder');
			return false;
		}
	}

	private isPathInCurrentFolder(path: string): boolean {
		if (!this.currentFolder) return false;
		
		if (this.isAllNotesMode) {
			// For All Notes mode: all paths are relevant
			return true;
		} else if (this.currentFolder.isRoot()) {
			// For root folder: all paths are relevant
			return true;
		} else {
			// For specific folder: check if path starts with folder path
			return path.startsWith(this.currentFolder.path + '/') || path === this.currentFolder.path;
		}
	}

	private async refreshFileList(): Promise<void> {
		if (!this.container || !this.currentFolder) return;
		
		// Clear element tracking before full refresh
		this.fileElements.clear();
		this.groupElements.clear();
		this.fileImageCache.clear();
		
		const content = this.container.querySelector('.folder-container-content');
		if (content) {
			content.empty();
			await this.renderFileList(content as HTMLElement);
		}
	}

	private updateContainerHeader(): void {
		if (!this.container || !this.currentFolder) return;
		
		const title = this.container.querySelector('.folder-container-title') as HTMLElement;
		if (!title) return;
		
		if (this.isAllNotesMode) {
			title.textContent = 'All Notes';
		} else {
			title.textContent = this.currentFolder.isRoot() ? 'Notes' : this.currentFolder.name;
		}
	}

	private async updateContainer(target: TFolder | 'ALL_NOTES'): Promise<void> {
		if (!this.container) return;
		
		// Update folder state
		if (target === 'ALL_NOTES') {
			this.isAllNotesMode = true;
			this.currentFolder = this.app.vault.getRoot(); // Use root for file operations
			// Update active folder in navigator
			this.navigatorView.setActiveFolder('ALL_NOTES');
		} else {
			this.isAllNotesMode = false;
			this.currentFolder = target;
			// Update active folder in navigator
			this.navigatorView.setActiveFolder(target.path);
		}
		
		// Update header title
		this.updateContainerHeader();
		
		// Refresh file list content
		await this.refreshFileList();
	}

	// Smart update methods for hybrid rendering
	private async updateFileItem(file: TFile): Promise<void> {
		console.log('[RENAME DEBUG] updateFileItem START', { filePath: file.path });
		
		const elements = this.fileElements.get(file.path);
		if (!elements) {
			console.log('[RENAME DEBUG] updateFileItem - no elements found for path');
			return;
		}
		
		console.log('[RENAME DEBUG] updateFileItem - found elements, updating');
		
		// Update title
		elements.title.textContent = file.basename;
		
		// Update preview and image using coordinated loading
		await this.loadFileContent(file, elements.preview, elements.image);
		
		// Update folder badge (should match renderFileItem logic)
		if (elements.folderBadge) {
			elements.folderBadge.remove();
			elements.folderBadge = undefined;
		}

		const shouldShowFolderBadge = (this.isAllNotesMode || !this.currentFolder?.isRoot()) && 
			!file.parent?.isRoot() && 
			(this.isAllNotesMode || file.parent !== this.currentFolder);
		
		if (shouldShowFolderBadge) {
			// Create meta if it doesn't exist
			if (!elements.meta) {
				elements.meta = elements.content.createEl('div', { cls: 'file-item-meta' });
			}
			const folderBadge = elements.meta.createEl('span', { cls: 'file-item-folder' });
			folderBadge.innerHTML = `📁 ${file.parent?.name || 'Notes'}`;
			elements.folderBadge = folderBadge;
		} else if (elements.meta) {
			// Remove empty meta element if no content
			elements.meta.remove();
			elements.meta = undefined;
		}
		
		// Update folder attribute
		let folderName: string;
		if (this.isAllNotesMode) {
			folderName = 'All Notes';
		} else if (this.currentFolder?.isRoot()) {
			folderName = 'Notes';
		} else {
			folderName = this.currentFolder?.name || 'Notes';
		}
		elements.container.setAttribute('folder', folderName);
		
		console.log('[RENAME DEBUG] updateFileItem END');
	}

	private async addFileItem(file: TFile, groupName: string): Promise<void> {
		const groupElements = this.groupElements.get(groupName);
		if (!groupElements) {
			// Group doesn't exist, create it
			this.ensureGroupExists(groupName);
			return this.addFileItem(file, groupName);
		}
		
		// Get sorted position for the file
		const files = this.getFilesInGroup(groupName);
		files.push(file);
		files.sort((a, b) => b.stat.ctime - a.stat.ctime);
		
		const insertIndex = files.indexOf(file);
		const existingItems = Array.from(groupElements.groupContainer.querySelectorAll('.file-item'));
		
		// Create temporary container to render the file item
		const tempContainer = document.createElement('div');
		await this.renderFileItem(tempContainer, file);
		const newItem = tempContainer.firstChild as HTMLElement;
		
		// Insert at correct position
		if (insertIndex === 0) {
			groupElements.groupContainer.insertBefore(newItem, existingItems[0] || null);
		} else {
			// Find the item to insert after (accounting for dividers)
			const itemIndex = Math.min(insertIndex, existingItems.length);
			const afterItem = existingItems[itemIndex - 1];
			if (afterItem && afterItem.nextSibling) {
				groupElements.groupContainer.insertBefore(newItem, afterItem.nextSibling);
			} else {
				groupElements.groupContainer.appendChild(newItem);
			}
		}
		
		// Add divider if needed
		if (existingItems.length > 0) {
			const divider = document.createElement('div');
			divider.className = 'file-item-divider';
			if (insertIndex === 0) {
				groupElements.groupContainer.insertBefore(divider, newItem.nextSibling);
			} else {
				groupElements.groupContainer.insertBefore(divider, newItem);
			}
		}
	}

	private removeFileItem(file: TFile): void {
		console.log('[DELETE DEBUG] removeFileItem START', { 
			filePath: file.path,
			fileElementsSize: this.fileElements.size,
			hasElements: this.fileElements.has(file.path)
		});
		
		const elements = this.fileElements.get(file.path);
		if (!elements) {
			console.log('[DELETE DEBUG] removeFileItem - no elements found for file', {
				filePath: file.path,
				availableKeys: Array.from(this.fileElements.keys())
			});
			return;
		}
		
		console.log('[DELETE DEBUG] removeFileItem - found elements, removing DOM and maps');
		
		// Remove the divider after this item (if exists)
		const nextSibling = elements.container.nextSibling;
		if (nextSibling && (nextSibling as HTMLElement).className === 'file-item-divider') {
			nextSibling.remove();
		} else {
			// Remove the divider before this item (if it's the first item)
			const prevSibling = elements.container.previousSibling;
			if (prevSibling && (prevSibling as HTMLElement).className === 'file-item-divider') {
				prevSibling.remove();
			}
		}
		
		// Remove the file item
		elements.container.remove();
		this.fileElements.delete(file.path);
		this.fileImageCache.delete(file.path);
		
		// Check if group is now empty and remove if needed
		const groupName = this.getTargetGroup(file);
		console.log('[DELETE DEBUG] removeFileItem - checking for empty group', { groupName });
		this.removeEmptyGroup(groupName);
		
		console.log('[DELETE DEBUG] removeFileItem END - successful removal', {
			filePath: file.path,
			remainingFilesCount: this.fileElements.size
		});
	}

	private async moveFileItem(file: TFile, oldGroupName: string, newGroupName: string): Promise<void> {
		console.log('[RENAME DEBUG] moveFileItem START', {
			filePath: file.path,
			oldGroupName,
			newGroupName
		});
		
		this.removeFileItem(file);
		await this.addFileItem(file, newGroupName);
		
		console.log('[RENAME DEBUG] moveFileItem END');
	}

	private ensureGroupExists(groupName: string): void {
		if (this.groupElements.has(groupName)) return;
		
		const content = this.container?.querySelector('.folder-container-content');
		if (!content) return;
		
		// Determine where to insert this group based on date order
		const groups = Array.from(this.groupElements.keys());
		
		let insertBefore: HTMLElement | null = null;
		
		// Find correct position to insert the group
		for (const existingGroup of groups) {
			const existingGroupElement = this.groupElements.get(existingGroup)?.container;
			if (!existingGroupElement) continue;
			
			if (this.compareGroupOrder(groupName, existingGroup) < 0) {
				insertBefore = existingGroupElement;
				break;
			}
		}
		
		// Create the group with empty files array
		const tempContainer = document.createElement('div');
		this.renderFileGroup(tempContainer, groupName, []);
		const newGroup = tempContainer.firstChild as HTMLElement;
		
		if (insertBefore) {
			content.insertBefore(newGroup, insertBefore);
		} else {
			content.appendChild(newGroup);
		}
	}

	private removeEmptyGroup(groupName: string): void {
		const groupElements = this.groupElements.get(groupName);
		if (!groupElements) return;
		
		// Check if group is empty
		const fileItems = groupElements.groupContainer.querySelectorAll('.file-item');
		if (fileItems.length === 0) {
			groupElements.container.remove();
			this.groupElements.delete(groupName);
		}
	}

	private getTargetGroup(file: TFile): string {
		// Check if file is pinned first - pinned files always go to Pinned group
		if (this.plugin.isPathPinned(file.path, 'file')) {
			return 'Pinned';
		}
		
		const fileDate = new Date(file.stat.ctime);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
		const fileDateOnly = new Date(fileDate.getFullYear(), fileDate.getMonth(), fileDate.getDate());
		
		let groupName: string;
		if (fileDateOnly.getTime() === today.getTime()) {
			groupName = 'Today';
		} else if (fileDateOnly.getTime() === yesterday.getTime()) {
			groupName = 'Yesterday';
		} else {
			groupName = this.formatDateGroup(fileDate);
		}
		
		
		return groupName;
	}

	private getFilesInGroup(groupName: string): TFile[] {
		const files: TFile[] = [];
		const groupElements = this.groupElements.get(groupName);
		if (!groupElements) return files;
		
		// Get files from existing DOM elements
		for (const [filePath, elements] of this.fileElements.entries()) {
			if (groupElements.groupContainer.contains(elements.container)) {
				const file = this.app.vault.getFileByPath(filePath);
				if (file instanceof TFile) {
					files.push(file);
				}
			}
		}
		
		return files;
	}

	private compareGroupOrder(groupA: string, groupB: string): number {
		const order = ['Today', 'Yesterday'];
		const indexA = order.indexOf(groupA);
		const indexB = order.indexOf(groupB);
		
		// If both are in predefined order
		if (indexA !== -1 && indexB !== -1) {
			return indexA - indexB;
		}
		
		// If only A is in predefined order, A comes first
		if (indexA !== -1) return -1;
		
		// If only B is in predefined order, B comes first
		if (indexB !== -1) return 1;
		
		// Both are date strings, compare by date (newest first)
		// This would need date parsing, but for simplicity, use string comparison
		return groupB.localeCompare(groupA);
	}

	// VaultUpdateHandler interface implementation
	handleFileCreate(file: TAbstractFile, affectedFolders: string[]): void {
		if (!this.container || !this.currentFolder) return;
		
		// Only handle files in the current folder or its children
		if (!this.isFileInCurrentFolder(file)) return;
		
		if (file instanceof TFile) {
			const groupName = this.getTargetGroup(file);
			// Use setTimeout to avoid blocking
			setTimeout(async () => {
				await this.addFileItem(file, groupName);
			}, 0);
		}
	}

	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void {
		console.log('[DELETE DEBUG] handleFileDelete START', {
			filePath: file.path,
			fileName: file instanceof TFile ? file.basename : file.name,
			container: !!this.container,
			currentFolder: this.currentFolder?.path,
			affectedFolders,
			fileInCurrentFolder: this.isFileInCurrentFolder(file),
			fileInElements: file instanceof TFile && this.fileElements.has(file.path)
		});

		if (!this.container || !this.currentFolder) {
			console.log('[DELETE DEBUG] Early return - no container or folder');
			return;
		}
		
		// Only handle files that were in the current folder or its children
		if (!this.isFileInCurrentFolder(file)) {
			console.log('[DELETE DEBUG] Early return - file not in current folder');
			return;
		}
		
		if (file instanceof TFile) {
			console.log('[DELETE DEBUG] Processing file deletion');
			this.removeFileItem(file);
		} else {
			console.log('[DELETE DEBUG] Not a TFile, skipping');
		}

		console.log('[DELETE DEBUG] handleFileDelete END');
	}

	handleFileRename(file: TAbstractFile, oldPath: string, affectedFolders: string[]): void {
		console.log('[RENAME DEBUG] handleFileRename START', {
			oldPath,
			newPath: file.path,
			fileName: file instanceof TFile ? file.basename : file.name,
			container: !!this.container,
			currentFolder: this.currentFolder?.path
		});
		
		if (!this.container || !this.currentFolder) {
			console.log('[RENAME DEBUG] Early return - no container or folder');
			return;
		}
		
		// Check if file was or is now in current folder
		const wasInFolder = this.isPathInCurrentFolder(oldPath);
		const isInFolder = this.isFileInCurrentFolder(file);
		
		console.log('[RENAME DEBUG] Folder checks', {
			wasInFolder,
			isInFolder,
			oldPath,
			newPath: file.path
		});
		
		if (file instanceof TFile) {
			// Log current Map state
			console.log('[RENAME DEBUG] Current fileElements keys:', Array.from(this.fileElements.keys()));
			console.log('[RENAME DEBUG] Element lookup by oldPath:', this.fileElements.has(oldPath));
			console.log('[RENAME DEBUG] Element lookup by newPath:', this.fileElements.has(file.path));
			
			if (wasInFolder && isInFolder) {
				console.log('[RENAME DEBUG] File renamed within current folder');
				
				// File was renamed within current folder
				const oldGroupName = this.getTargetGroupFromPath(oldPath);
				const newGroupName = this.getTargetGroup(file);
				
				console.log('[RENAME DEBUG] Group determination', {
					oldGroupName,
					newGroupName,
					oldPath,
					newPath: file.path
				});
				
				// Update element map key BEFORE any operations
				this.updateElementMapKey(oldPath, file.path);
				
				if (oldGroupName === newGroupName) {
					console.log('[RENAME DEBUG] Same group - updating file item');
					// Same group, just update the file item
					setTimeout(async () => {
						await this.updateFileItem(file);
					}, 0);
				} else {
					console.log('[RENAME DEBUG] Different group - moving file item');
					// Different group, move the file
					setTimeout(async () => {
						await this.moveFileItem(file, oldGroupName, newGroupName);
					}, 0);
				}
			} else if (wasInFolder && !isInFolder) {
				console.log('[RENAME DEBUG] File moved out of current folder');
				// File was moved out of current folder
				this.removeFileItem(file);
			} else if (!wasInFolder && isInFolder) {
				console.log('[RENAME DEBUG] File moved into current folder');
				// File was moved into current folder
				const groupName = this.getTargetGroup(file);
				setTimeout(async () => {
					await this.addFileItem(file, groupName);
				}, 0);
			} else {
				console.log('[RENAME DEBUG] File rename not relevant to current folder');
			}
		}
		
		console.log('[RENAME DEBUG] handleFileRename END');
	}

	handleFileModify(file: TAbstractFile, affectedFolders: string[]): void {
		if (!this.container || !this.currentFolder) return;
		
		// Only handle files in the current folder or its children
		if (!this.isFileInCurrentFolder(file)) return;
		
		if (file instanceof TFile) {
			// Only process files that are currently displayed in the container
			if (!this.fileElements.has(file.path)) return;
			
			const currentGroupName = this.getCurrentGroupForFile(file);
			const targetGroupName = this.getTargetGroup(file);
			
			if (currentGroupName === targetGroupName) {
				// Same group, just update the file item (preview content, etc.)
				setTimeout(async () => {
					await this.updateFileItem(file);
				}, 0);
			} else {
				// Different group due to modification time change
				setTimeout(async () => {
					await this.moveFileItem(file, currentGroupName, targetGroupName);
				}, 0);
			}
		}
	}

	private getTargetGroupFromPath(filePath: string): string {
		console.log('[RENAME DEBUG] getTargetGroupFromPath START', { filePath });
		
		// Try to find element by old path first
		const elements = this.fileElements.get(filePath);
		console.log('[RENAME DEBUG] getTargetGroupFromPath elements lookup', {
			filePath,
			found: !!elements,
			availableKeys: Array.from(this.fileElements.keys())
		});
		
		if (elements) {
			// Find which group this element belongs to
			for (const [groupName, groupElements] of this.groupElements.entries()) {
				if (groupElements.groupContainer.contains(elements.container)) {
					console.log('[RENAME DEBUG] getTargetGroupFromPath found group', { groupName });
					return groupName;
				}
			}
			console.log('[RENAME DEBUG] getTargetGroupFromPath no containing group found');
		}
		
		// Fallback: try to find the element by searching all file elements
		console.log('[RENAME DEBUG] getTargetGroupFromPath trying DOM fallback');
		for (const [path, elementsData] of this.fileElements.entries()) {
			// Check if this could be the same file (same basename)
			const oldBasename = filePath.split('/').pop()?.split('.')[0];
			const currentBasename = path.split('/').pop()?.split('.')[0];
			
			if (oldBasename === currentBasename) {
				console.log('[RENAME DEBUG] getTargetGroupFromPath found potential match by basename', { 
					oldPath: filePath, 
					currentPath: path 
				});
				
				// Find which group this element belongs to
				for (const [groupName, groupElements] of this.groupElements.entries()) {
					if (groupElements.groupContainer.contains(elementsData.container)) {
						console.log('[RENAME DEBUG] getTargetGroupFromPath found group via DOM fallback', { groupName });
						return groupName;
					}
				}
			}
		}
		
		console.log('[RENAME DEBUG] getTargetGroupFromPath using final fallback: Today');
		return 'Today'; // final fallback
	}

	private getCurrentGroupForFile(file: TFile): string {
		const elements = this.fileElements.get(file.path);
		if (elements) {
			// Find which group this element belongs to
			for (const [groupName, groupElements] of this.groupElements.entries()) {
				if (groupElements.groupContainer.contains(elements.container)) {
					return groupName;
				}
			}
		}
		return this.getTargetGroup(file); // fallback to calculated group
	}

	private updateElementMapKey(oldPath: string, newPath: string): void {
		console.log('[RENAME DEBUG] updateElementMapKey START', { oldPath, newPath });
		
		const elements = this.fileElements.get(oldPath);
		if (elements) {
			console.log('[RENAME DEBUG] Found elements for oldPath, updating key');
			// Update the map key
			this.fileElements.delete(oldPath);
			this.fileElements.set(newPath, elements);
			console.log('[RENAME DEBUG] Map key updated successfully');
		} else {
			console.log('[RENAME DEBUG] No elements found for oldPath');
		}
		
		console.log('[RENAME DEBUG] Updated fileElements keys:', Array.from(this.fileElements.keys()));
	}

	private getNextUntitledNumber(targetFolder: TFolder): number {
		const files = targetFolder.children.filter(child => child instanceof TFile) as TFile[];
		const untitledPattern = /^Untitled( (\d+))?\.md$/;
		const existingNumbers: number[] = [];

		for (const file of files) {
			const match = file.name.match(untitledPattern);
			if (match) {
				if (match[2]) {
					// File has a number (e.g., "Untitled 2.md")
					existingNumbers.push(parseInt(match[2], 10));
				} else {
					// File is just "Untitled.md" (treat as number 0)
					existingNumbers.push(0);
				}
			}
		}

		// Find the next available number
		if (existingNumbers.length === 0) {
			return 0; // Start with "Untitled.md"
		}

		existingNumbers.sort((a, b) => a - b);
		
		// Find the first gap or return the next number after the highest
		for (let i = 0; i < existingNumbers.length; i++) {
			if (existingNumbers[i] !== i) {
				return i;
			}
		}
		
		return existingNumbers.length;
	}

	private async createNewNote(): Promise<void> {
		if (!this.currentFolder) return;
		
		try {
			// Determine the target folder for the new note
			let targetFolder: TFolder;
			
			if (this.isAllNotesMode) {
				// In All Notes mode, create in root folder
				targetFolder = this.app.vault.getRoot();
			} else {
				// In specific folder mode, create in current folder
				targetFolder = this.currentFolder;
			}
			
			// Generate a unique file name with incremental numbering
			const nextNumber = this.getNextUntitledNumber(targetFolder);
			const fileName = nextNumber === 0 ? 'Untitled.md' : `Untitled ${nextNumber}.md`;
			const filePath = targetFolder.path ? `${targetFolder.path}/${fileName}` : fileName;
			
			// Create the new file
			const newFile = await this.app.vault.create(filePath, '');
			
			// Open the new file in the main editor
			await this.app.workspace.openLinkText(newFile.path, '', false);
			
			// Don't close the container - keep it open for quick access
			
		} catch (error) {
			console.error('Failed to create new note:', error);
		}
	}

	private showFileContextMenu(event: MouseEvent, file: TFile): void {
		const menu = new Menu();
		
		// Open in new tab
		menu.addItem((item) => {
			item.setTitle('Open in new tab')
				.setIcon('external-link')
				.onClick(() => {
					this.app.workspace.getLeaf('tab').openFile(file);
				});
		});

		// Open in new pane (split)
		menu.addItem((item) => {
			item.setTitle('Open in new pane')
				.setIcon('separator-vertical')
				.onClick(() => {
					this.app.workspace.getLeaf('split', 'vertical').openFile(file);
				});
		});

		menu.addSeparator();

		// Pin/Unpin file
		const isPinned = this.plugin.isPathPinned(file.path, 'file');
		menu.addItem((item) => {
			item.setTitle(isPinned ? 'Unpin file' : 'Pin file')
				.setIcon(isPinned ? 'pin-off' : 'pin')
				.onClick(async () => {
					if (isPinned) {
						this.plugin.removePinnedPath(file.path, 'file');
					} else {
						this.plugin.addPinnedPath(file.path, 'file');
					}
					await this.plugin.saveSettings();
					await this.refreshFileList();
				});
		});

		// Rename file
		menu.addItem((item) => {
			item.setTitle('Rename')
				.setIcon('pencil')
				.onClick(() => {
					this.renameFilePrompt(file);
				});
		});

		// Move file
		menu.addItem((item) => {
			item.setTitle('Move file')
				.setIcon('folder-open')
				.onClick(() => {
					// Execute Obsidian's native move file command
					(this.app as any).commands.executeCommandById('file-explorer:move-file');
				});
		});

		// Hide file
		menu.addItem((item) => {
			item.setTitle('Hide file')
				.setIcon('eye-off')
				.onClick(() => {
					this.hideFilePrompt(file);
				});
		});

		menu.addSeparator();

		// Copy file path
		menu.addItem((item) => {
			item.setTitle('Copy path')
				.setIcon('copy')
				.onClick(() => {
					navigator.clipboard.writeText(file.path);
				});
		});

		// Delete file
		menu.addItem((item) => {
			item.setTitle('Delete')
				.setIcon('trash')
				.onClick(() => {
					this.deleteFilePrompt(file);
				});
		});

		menu.showAtMouseEvent(event);
	}

	private async renameFilePrompt(file: TFile): Promise<void> {
		const modal = new TextInputModal(this.app, 'Rename File', 'Enter new file name', file.basename);
		const newName = await modal.openAndGetValue();
		
		if (newName && newName !== file.basename && newName.trim() !== '') {
			const extension = file.extension ? `.${file.extension}` : '';
			const newPath = file.parent ? `${file.parent.path}/${newName.trim()}${extension}` : `${newName.trim()}${extension}`;
			
			try {
				await this.app.vault.rename(file, newPath);
			} catch (error) {
				console.error('Failed to rename file:', error);
			}
		}
	}


	private async deleteFilePrompt(file: TFile): Promise<void> {
		try {
			await this.app.vault.trash(file, true);
		} catch (error) {
			console.error('Failed to delete file:', error);
		}
	}

	private async hideFilePrompt(file: TFile): Promise<void> {
		try {
			// Add file path to hidden files using optimized method
			if (!this.plugin.isPathHidden(file.path, 'file')) {
				this.plugin.addHiddenPath(file.path, 'file');
				await this.plugin.saveSettings();
				
				// Refresh the file list to hide the file
				await this.refreshFileList();
				
				new Notice(`File "${file.basename}" hidden`);
			}
		} catch (error) {
			console.error('Failed to hide file:', error);
			new Notice(`Failed to hide file: ${error.message}`);
		}
	}

	private isFileHidden(path: string): boolean {
		return this.plugin.isPathHidden(path, 'file');
	}
}