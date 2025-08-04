import { ItemView, WorkspaceLeaf, TFolder, TFile, TAbstractFile, Vault, Notice, Menu, Modal, Setting, App } from 'obsidian';
import { VaultObserver, VaultUpdateHandler } from './vault-observer';
import { FolderContainerManager } from './folder-container-manager';
import MyPlugin from './main';

export const NAVIGATOR_VIEW_TYPE = 'navigator-view';

export class TextInputModal extends Modal {
	private result: string | null = null;
	private submitted = false;

	constructor(app: App, private title: string, private placeholder: string, private defaultValue: string = '') {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });

		new Setting(contentEl)
			.addText((text) => {
				text.setPlaceholder(this.placeholder)
					.setValue(this.defaultValue)
					.onChange((value) => {
						this.result = value;
					});
				
				// Focus the input and select text if there's a default value
				setTimeout(() => {
					text.inputEl.focus();
					if (this.defaultValue) {
						text.inputEl.select();
					}
				}, 10);
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					});
			})
			.addButton((btn) => {
				btn.setButtonText('Submit')
					.setCta()
					.onClick(() => {
						this.submitted = true;
						this.close();
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	async openAndGetValue(): Promise<string | null> {
		return new Promise((resolve) => {
			this.onClose = () => {
				const { contentEl } = this;
				contentEl.empty();
				resolve(this.submitted ? this.result : null);
			};
			this.open();
		});
	}
}

interface FolderElements {
	container: HTMLElement;
	header: HTMLElement;
	icon: HTMLElement;
	chevron?: HTMLElement;
	count: HTMLElement;
	children?: HTMLElement;
}

export class NavigatorView extends ItemView implements VaultUpdateHandler {
	private expandedFolders: Set<string> = new Set();
	private folderCounts: Map<string, number> = new Map();
	private rootOnlyCount: number = 0;
	private folderElements: Map<string, FolderElements> = new Map();
	private containerManager: FolderContainerManager;
	private activeFolder: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: MyPlugin) {
		super(leaf);
		this.containerManager = new FolderContainerManager(this.app, plugin, this);
	}

	getViewType(): string {
		return NAVIGATOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Navigator';
	}

	getIcon(): string {
		return 'navigation';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('navigator-view');
		
		const title = container.createEl('div', { cls: 'navigator-title' });
		
		const titleText = title.createEl('span', { cls: 'navigator-title-text' });
		titleText.textContent = 'Folders';
		
		const createFolderBtn = title.createEl('button', { cls: 'navigator-create-folder-btn' });
		createFolderBtn.textContent = '+';
		createFolderBtn.addEventListener('click', () => {
			this.createNewFolder();
		});
		
		const treeContainer = container.createEl('div', { cls: 'folder-tree' });
		this.renderFolderTree(treeContainer);
		
		// Register with VaultObserver instead of direct vault events
		VaultObserver.getInstance(this.app).registerView(this);
	}

	async onClose(): Promise<void> {
		// Clear active folder state
		this.clearActiveFolder();
		// Unregister from VaultObserver
		VaultObserver.getInstance(this.app).unregisterView(this);
		// Clean up container manager
		this.containerManager.cleanup();
	}

	private createLucideIcon(pathData: string, className: string = ''): SVGSVGElement {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		
		if (className) {
			svg.setAttribute('class', className);
		}
		
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', pathData);
		svg.appendChild(path);
		
		return svg;
	}

	private getFolderIcon(isExpanded: boolean, hasChildren: boolean): SVGSVGElement {
		if (hasChildren && isExpanded) {
			// folder-open icon
			return this.createLucideIcon('m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2');
		} else {
			// folder icon
			return this.createLucideIcon('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z');
		}
	}

	private getChevronIcon(isExpanded: boolean): SVGSVGElement {
		const className = isExpanded ? 'folder-chevron expanded' : 'folder-chevron collapsed';
		return this.createLucideIcon('m9 18 6-6-6-6', className);
	}

	private renderFolderTree(container: HTMLElement): void {
		this.calculateFolderCounts();
		
		const rootFolder = this.app.vault.getRoot();
		
		// Render "All Notes" at the top
		this.renderAllNotesHeader(container);
		
		// Render root folder as a non-collapsible header
		this.renderRootHeader(rootFolder, container);
		
		// Render root's subfolders directly at depth 0
		const subfolders = rootFolder.children
			.filter(child => child instanceof TFolder) as TFolder[];
		const visibleSubfolders = subfolders.filter(folder => !this.isHidden(folder.path));
		
		// Sort with pinned folders first, then alphabetically within each group
		visibleSubfolders.sort((a, b) => {
			const aIsPinned = this.plugin.isPathPinned(a.path, 'folder');
			const bIsPinned = this.plugin.isPathPinned(b.path, 'folder');
			
			if (aIsPinned && !bIsPinned) return -1;
			if (!aIsPinned && bIsPinned) return 1;
			return a.name.localeCompare(b.name);
		});
		
		for (const subfolder of visibleSubfolders) {
			this.renderFolder(subfolder, container, 0);
		}
	}

	private renderRootHeader(rootFolder: TFolder, container: HTMLElement): void {
		const rootEl = container.createEl('div', { cls: 'folder-item root-header' });
		rootEl.setAttribute('data-folder-path', rootFolder.path);

		const rootHeader = rootEl.createEl('div', { cls: 'folder-header' });

		// Add click handler for root folder header (excluding chevron)
		rootHeader.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target) {
				this.containerManager.openContainer(rootFolder);
			}
		});

		// Add context menu handler for root folder
		rootHeader.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFolderContextMenu(e, rootFolder);
		});

		// Root folder icon (always closed folder icon since it's not collapsible)
		const folderIconContainer = rootHeader.createEl('span', { cls: 'folder-icon' });
		const folderIcon = this.getFolderIcon(false, true);
		folderIconContainer.appendChild(folderIcon);

		// Root folder name
		const folderName = rootHeader.createEl('span', { cls: 'folder-name' });
		folderName.textContent = 'Notes';

		// Root folder note count (root files only, no subfolders)
		const noteCount = this.rootOnlyCount;
		const countEl = rootHeader.createEl('span', { cls: 'folder-count' });
		countEl.textContent = noteCount.toString();

		// Removed chevron span for root header

		// Store element references for updates (no children for root)
		this.folderElements.set(rootFolder.path, {
			container: rootEl,
			header: rootHeader,
			icon: folderIconContainer,
			count: countEl
		});
	}

	private renderAllNotesHeader(container: HTMLElement): void {
		const allNotesEl = container.createEl('div', { cls: 'folder-item all-notes-header' });
		
		const header = allNotesEl.createEl('div', { cls: 'folder-header' });
		
		// Add click handler for All Notes header
		header.addEventListener('click', () => {
			this.containerManager.openContainer('ALL_NOTES');
		});
		
		// All Notes icon (using folder icon like other folders)
		const folderIconContainer = header.createEl('span', { cls: 'folder-icon' });
		const folderIcon = this.getFolderIcon(false, false);
		folderIcon.addClass('all-notes-icon');
		folderIconContainer.appendChild(folderIcon);
		
		// All Notes name
		const folderName = header.createEl('span', { cls: 'folder-name all-notes-name' });
		folderName.textContent = 'All Notes';
		
		// Total file count
		const totalCount = this.getTotalFileCount();
		const countEl = header.createEl('span', { cls: 'folder-count all-notes-count' });
		countEl.textContent = totalCount.toString();
		
		// No chevron for All Notes (it's not expandable)
	}

	private renderFolder(folder: TFolder, parent: HTMLElement, depth: number): void {
		const folderEl = parent.createEl('div', { cls: 'folder-item' });
		folderEl.style.paddingLeft = `${depth * 16}px`;
		folderEl.setAttribute('data-folder-path', folder.path);
		
		// Add pinned class if folder is pinned
		if (this.plugin.isPathPinned(folder.path, 'folder')) {
			folderEl.addClass('pinned');
		}
		
		const folderHeader = folderEl.createEl('div', { cls: 'folder-header' });
		
		// Add click handler for folder header (not chevron)
		folderHeader.addEventListener('click', (e) => {
			// Prevent if clicking chevron
			const target = e.target as HTMLElement;
			if (target && !target.closest('.folder-chevron-container')) {
				this.containerManager.openContainer(folder);
			}
		});

		// Add context menu handler for folder
		folderHeader.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFolderContextMenu(e, folder);
		});
		
		const hasChildren = folder.children.some(child => child instanceof TFolder);
		const isExpanded = this.expandedFolders.has(folder.path);
		
		const folderIconContainer = folderHeader.createEl('span', { cls: 'folder-icon' });
		const folderIcon = this.getFolderIcon(isExpanded, hasChildren);
		folderIconContainer.appendChild(folderIcon);
		
		const folderName = folderHeader.createEl('span', { cls: 'folder-name' });
		folderName.textContent = folder.name;
		
		const noteCount = this.folderCounts.get(folder.path) || 0;
		const countEl = folderHeader.createEl('span', { cls: 'folder-count' });
		countEl.textContent = noteCount.toString();
		
		let chevronElement: HTMLElement | undefined;
		let childrenContainer: HTMLElement | undefined;
		
		// Always create chevron for all folders (consistent visual layout)
		const chevronContainer = folderHeader.createEl('span', { cls: 'folder-chevron-container' });
		const chevron = this.getChevronIcon(isExpanded);
		chevronContainer.appendChild(chevron);
		chevronElement = chevronContainer;
		
		if (hasChildren) {
			// Interactive chevron and count for folders with children
			chevron.addClass('interactive');
			chevronContainer.addClass('clickable');
			countEl.addClass('interactive');
			
			chevronContainer.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleFolder(folder.path);
			});
			
			childrenContainer = folderEl.createEl('div', { cls: 'folder-children' });
			
			// Always render children but control visibility with CSS classes
			const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
			const visibleSubfolders = subfolders.filter(subfolder => !this.isHidden(subfolder.path));
			
			// Sort with pinned folders first, then alphabetically within each group
			visibleSubfolders.sort((a, b) => {
				const aIsPinned = this.plugin.isPathPinned(a.path, 'folder');
				const bIsPinned = this.plugin.isPathPinned(b.path, 'folder');
				
				if (aIsPinned && !bIsPinned) return -1;
				if (!aIsPinned && bIsPinned) return 1;
				return a.name.localeCompare(b.name);
			});
			
			for (const subfolder of visibleSubfolders) {
				this.renderFolder(subfolder, childrenContainer, depth + 1);
			}
			
			// Set initial animation state
			if (isExpanded) {
				childrenContainer.addClass('expanded');
			}
			// Note: collapsed state is handled by default CSS Grid state (0fr)
		} else {
			// Non-interactive chevron and count for folders without children (decorative only)
			chevron.addClass('non-interactive');
			chevronContainer.addClass('non-clickable');
			countEl.addClass('non-interactive');
		}
		
		// Store element references for smart updates
		this.folderElements.set(folder.path, {
			container: folderEl,
			header: folderHeader,
			icon: folderIconContainer,
			chevron: chevronElement,
			count: countEl,
			children: childrenContainer
		});
	}

	private calculateFolderCounts(): void {
		this.folderCounts.clear();
		
		const processFolder = (folder: TFolder): number => {
			let count = 0;
			
			for (const child of folder.children) {
				if (child instanceof TFile) {
					count++;
				} else if (child instanceof TFolder) {
					count += processFolder(child);
				}
			}
			
			this.folderCounts.set(folder.path, count);
			return count;
		};
		
		processFolder(this.app.vault.getRoot());
		this.calculateRootOnlyCount();
	}

	private calculateRootOnlyCount(): void {
		const rootFolder = this.app.vault.getRoot();
		let count = 0;
		
		for (const child of rootFolder.children) {
			if (child instanceof TFile) {
				count++;
			}
		}
		
		this.rootOnlyCount = count;
	}

	private getTotalFileCount(): number {
		let totalCount = 0;
		Vault.recurseChildren(this.app.vault.getRoot(), (file: TAbstractFile) => {
			if (file instanceof TFile) {
				totalCount++;
			}
		});
		return totalCount;
	}

	private toggleFolder(folderPath: string): void {
		const isExpanded = this.expandedFolders.has(folderPath);
		const newExpanded = !isExpanded;
		
		if (newExpanded) {
			this.expandedFolders.add(folderPath);
		} else {
			this.expandedFolders.delete(folderPath);
		}
		
		this.updateFolderExpansion(folderPath, newExpanded);
	}

	private updateFolderExpansion(folderPath: string, isExpanded: boolean): void {
		const elements = this.folderElements.get(folderPath);
		if (!elements || !elements.chevron || !elements.children) return;
		
		const folder = this.app.vault.getFolderByPath(folderPath);
		if (!folder) return;
		
		// Update chevron rotation
		const chevronIcon = elements.chevron.querySelector('.folder-chevron');
		if (chevronIcon) {
			if (isExpanded) {
				chevronIcon.addClass('expanded');
			} else {
				chevronIcon.removeClass('expanded');
			}
		}
		
		// Update folder icon
		const hasChildren = folder.children.some(child => child instanceof TFolder);
		const newIcon = this.getFolderIcon(isExpanded, hasChildren);
		elements.icon.empty();
		elements.icon.appendChild(newIcon);
		
		// Manage children with smooth animation
		if (isExpanded) {
			// Render children if not already rendered
			if (elements.children.children.length === 0) {
				const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
				const visibleSubfolders = subfolders.filter(subfolder => !this.isHidden(subfolder.path));
				visibleSubfolders.sort((a, b) => a.name.localeCompare(b.name));
				
				const depth = (elements.container.style.paddingLeft.replace('px', '') as any) / 16 + 1;
				for (const subfolder of visibleSubfolders) {
					this.renderFolder(subfolder, elements.children, depth);
				}
			}
			
			// Expand with smooth animation
			elements.children.addClass('expanded');
		} else {
			// Collapse with smooth animation
			elements.children.removeClass('expanded');
		}
	}

	private updateFolderCount(folderPath: string, newCount: number): void {
		const elements = this.folderElements.get(folderPath);
		if (elements) {
			elements.count.textContent = newCount.toString();
		}
	}

	// VaultUpdateHandler interface implementation
	handleFileCreate(file: TAbstractFile, affectedFolders: string[]): void {
		if (file instanceof TFile) {
			this.updateCountsForAffectedFolders();
		} else if (file instanceof TFolder) {
			// For new folders, we need a full refresh
			this.refreshView();
		}
	}

	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void {
		if (file instanceof TFile) {
			this.updateCountsForAffectedFolders();
		} else if (file instanceof TFolder) {
			// Remove folder element and refresh parent
			this.folderElements.delete(file.path);
			this.refreshView();
		}
	}

	handleFileRename(file: TAbstractFile, oldPath: string, affectedFolders: string[]): void {
		if (file instanceof TFolder) {
			// Update folder element references and refresh
			this.folderElements.delete(oldPath);
			this.refreshView();
		} else {
			// Update counts for all affected folders
			this.updateCountsForAffectedFolders();
		}
	}

	handleFileModify(file: TAbstractFile, affectedFolders: string[]): void {
		// Only handle folder structure modifications
		if (file instanceof TFolder) {
			this.updateCountsForAffectedFolders();
		}
	}

	private updateCountsForAffectedFolders(): void {
		// Recalculate all counts
		this.calculateFolderCounts();

		const rootPath = this.app.vault.getRoot().path;
		const totalCount = this.folderCounts.get(rootPath) || 0;

		// Update All Notes count
		const allNotesCountEl = this.containerEl.querySelector('.all-notes-count');
		if (allNotesCountEl) {
			allNotesCountEl.textContent = totalCount.toString();
		}
		
		// Update all visible folder counts
		for (const [folderPath, elements] of this.folderElements.entries()) {
			let newCount: number;
			if (folderPath === rootPath) {
				newCount = this.rootOnlyCount;
			} else {
				newCount = this.folderCounts.get(folderPath) || 0;
			}
			elements.count.textContent = newCount.toString();
		}
	}

	private refreshView(): void {
		// Store current active folder to restore after refresh
		const currentActiveFolder = this.activeFolder;
		
		// Clear element tracking and do full refresh as fallback
		this.folderElements.clear();
		const container = this.containerEl.querySelector('.folder-tree');
		if (container) {
			container.empty();
			this.renderFolderTree(container as HTMLElement);
			
			// Restore active folder state after refresh
			if (currentActiveFolder) {
				this.activeFolder = currentActiveFolder;
				this.highlightActiveFolder(currentActiveFolder);
			}
		}
	}

	private async createNewFolder(): Promise<void> {
		// Generate default folder name
		const nextNumber = this.getNextUntitledFolderNumber();
		const folderName = nextNumber === 0 ? 'Untitled' : `Untitled ${nextNumber}`;
		
		try {
			await this.app.vault.createFolder(folderName);
			// The VaultObserver will handle updating the UI automatically
		} catch (error) {
			console.error('Failed to create folder:', error);
			// Show error to user if folder creation fails
			new Notice(`Failed to create folder: ${error.message}`);
		}
	}

	private getNextUntitledFolderNumber(): number {
		const rootFolder = this.app.vault.getRoot();
		const folders = rootFolder.children.filter(child => child instanceof TFolder) as TFolder[];
		const untitledPattern = /^Untitled( (\d+))?$/;
		const existingNumbers: number[] = [];

		for (const folder of folders) {
			const match = folder.name.match(untitledPattern);
			if (match) {
				if (match[2]) {
					// Folder has a number (e.g., "Untitled 2")
					existingNumbers.push(parseInt(match[2], 10));
				} else {
					// Folder is just "Untitled" (treat as number 0)
					existingNumbers.push(0);
				}
			}
		}

		// Find the next available number
		if (existingNumbers.length === 0) {
			return 0; // Start with "Untitled"
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


	// Active folder management methods
	setActiveFolder(folderPath: string): void {
		// Clear previous active folder
		this.clearActiveFolder();
		
		// Set new active folder
		this.activeFolder = folderPath;
		
		// Apply active styling
		this.highlightActiveFolder(folderPath);
	}

	clearActiveFolder(): void {
		if (this.activeFolder) {
			this.removeActiveFolderHighlight(this.activeFolder);
			this.activeFolder = null;
		}
	}

	private highlightActiveFolder(folderPath: string): void {
		const folderElement = this.folderElements.get(folderPath);
		if (folderElement) {
			folderElement.container.addClass('folder-active');
		}
		
		// Handle special case for "All Notes"
		if (folderPath === 'ALL_NOTES') {
			const allNotesEl = this.containerEl.querySelector('.all-notes-header');
			if (allNotesEl) {
				allNotesEl.addClass('folder-active');
			}
		}
	}

	private removeActiveFolderHighlight(folderPath: string): void {
		const folderElement = this.folderElements.get(folderPath);
		if (folderElement) {
			folderElement.container.removeClass('folder-active');
		}
		
		// Handle special case for "All Notes"
		if (folderPath === 'ALL_NOTES') {
			const allNotesEl = this.containerEl.querySelector('.all-notes-header');
			if (allNotesEl) {
				allNotesEl.removeClass('folder-active');
			}
		}
	}

	private showFolderContextMenu(event: MouseEvent, folder: TFolder): void {
		const menu = new Menu();
		
		// Create new file in folder
		menu.addItem((item) => {
			item.setTitle('New note')
				.setIcon('file-plus')
				.onClick(() => {
					this.createNewFileInFolder(folder);
				});
		});

		// Create new folder in folder
		menu.addItem((item) => {
			item.setTitle('New folder')
				.setIcon('folder-plus')
				.onClick(() => {
					this.createNewFolderInFolder(folder);
				});
		});

		menu.addSeparator();

		// Pin/Unpin folder
		const isPinned = this.plugin.isPathPinned(folder.path, 'folder');
		menu.addItem((item) => {
			item.setTitle(isPinned ? 'Unpin folder' : 'Pin folder')
				.setIcon(isPinned ? 'pin-off' : 'pin')
				.onClick(async () => {
					if (isPinned) {
						this.plugin.removePinnedPath(folder.path, 'folder');
					} else {
						this.plugin.addPinnedPath(folder.path, 'folder');
					}
					await this.plugin.saveSettings();
					this.refreshView();
				});
		});

		// Hide folder
		menu.addItem((item) => {
			item.setTitle('Hide folder')
				.setIcon('eye-off')
				.onClick(() => {
					this.hideFolderPrompt(folder);
				});
		});

		// Rename folder (only for non-root folders)
		if (folder.path !== '') {
			menu.addItem((item) => {
				item.setTitle('Rename')
					.setIcon('pencil')
					.onClick(() => {
						this.renameFolderPrompt(folder);
					});
			});
		}

		// Delete folder (only for non-root folders)
		if (folder.path !== '') {
			menu.addItem((item) => {
				item.setTitle('Delete folder')
					.setIcon('trash')
					.onClick(() => {
						this.deleteFolderPrompt(folder);
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	private async createNewFileInFolder(folder: TFolder): Promise<void> {
		const fileName = 'Untitled.md';
		const filePath = folder.path ? `${folder.path}/${fileName}` : fileName;
		
		// Generate unique filename if already exists
		let finalPath = filePath;
		let counter = 1;
		while (await this.app.vault.adapter.exists(finalPath)) {
			const baseName = fileName.replace('.md', '');
			finalPath = folder.path ? `${folder.path}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`;
			counter++;
		}

		try {
			const file = await this.app.vault.create(finalPath, '');
			// Open the newly created file
			this.app.workspace.getLeaf().openFile(file);
		} catch (error) {
			console.error('Failed to create file:', error);
			new Notice(`Failed to create file: ${error.message}`);
		}
	}

	private async createNewFolderInFolder(folder: TFolder): Promise<void> {
		const folderName = 'New folder';
		const folderPath = folder.path ? `${folder.path}/${folderName}` : folderName;
		
		// Generate unique folder name if already exists
		let finalPath = folderPath;
		let counter = 1;
		while (await this.app.vault.adapter.exists(finalPath)) {
			finalPath = folder.path ? `${folder.path}/${folderName} ${counter}` : `${folderName} ${counter}`;
			counter++;
		}

		try {
			await this.app.vault.createFolder(finalPath);
		} catch (error) {
			console.error('Failed to create folder:', error);
			new Notice(`Failed to create folder: ${error.message}`);
		}
	}

	private async renameFolderPrompt(folder: TFolder): Promise<void> {
		const modal = new TextInputModal(this.app, 'Rename Folder', 'Enter new folder name', folder.name);
		const newName = await modal.openAndGetValue();
		
		if (newName && newName !== folder.name && newName.trim() !== '') {
			const parentPath = folder.parent?.path || '';
			const newPath = parentPath ? `${parentPath}/${newName.trim()}` : newName.trim();
			
			try {
				await this.app.vault.rename(folder, newPath);
			} catch (error) {
				console.error('Failed to rename folder:', error);
				new Notice(`Failed to rename folder: ${error.message}`);
			}
		}
	}

	private async deleteFolderPrompt(folder: TFolder): Promise<void> {
		try {
			await this.app.vault.trash(folder, true);
		} catch (error) {
			console.error('Failed to delete folder:', error);
			new Notice(`Failed to delete folder: ${error.message}`);
		}
	}

	private async hideFolderPrompt(folder: TFolder): Promise<void> {
		try {
			// Add folder path to hidden folders using optimized method
			if (!this.plugin.isPathHidden(folder.path, 'folder')) {
				this.plugin.addHiddenPath(folder.path, 'folder');
				await this.plugin.saveSettings();
				
				// Refresh the view to hide the folder
				this.refreshView();
				
				new Notice(`Folder "${folder.name}" hidden`);
			}
		} catch (error) {
			console.error('Failed to hide folder:', error);
			new Notice(`Failed to hide folder: ${error.message}`);
		}
	}

	private isHidden(path: string): boolean {
		return this.plugin.isPathHidden(path, 'folder');
	}
}

