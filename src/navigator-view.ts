import { ItemView, WorkspaceLeaf, TFolder, TFile, TAbstractFile, Vault, Modal, App, Notice } from 'obsidian';
import { VaultObserver, VaultUpdateHandler } from './vault-observer';
import { FolderContainerManager } from './folder-container-manager';
import MyPlugin from './main';

export const NAVIGATOR_VIEW_TYPE = 'navigator-view';

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
		const subfolders = rootFolder.children.filter(child => child instanceof TFolder) as TFolder[];
		subfolders.sort((a, b) => a.name.localeCompare(b.name));
		
		for (const subfolder of subfolders) {
			this.renderFolder(subfolder, container, 0);
		}
	}

	private renderRootHeader(rootFolder: TFolder, container: HTMLElement): void {
		const rootEl = container.createEl('div', { cls: 'folder-item root-header' });
		rootEl.setAttribute('data-folder-path', rootFolder.path);
		
		const rootHeader = rootEl.createEl('div', { cls: 'folder-header' });
		
		// Add click handler for root folder header (excluding chevron)
		rootHeader.addEventListener('click', (e) => {
			// Prevent if clicking chevron
			const target = e.target as HTMLElement;
			if (target && !target.closest('.folder-chevron-container')) {
				this.containerManager.openContainer(rootFolder);
			}
		});
		
		// Root folder icon (always closed folder icon since it's not collapsible)
		const folderIconContainer = rootHeader.createEl('span', { cls: 'folder-icon' });
		const folderIcon = this.getFolderIcon(false, true);
		folderIconContainer.appendChild(folderIcon);
		
		// Root folder name
		const folderName = rootHeader.createEl('span', { cls: 'folder-name' });
		folderName.textContent = 'Notes';
		
		// Root folder note count
		const noteCount = this.folderCounts.get(rootFolder.path) || 0;
		const countEl = rootHeader.createEl('span', { cls: 'folder-count' });
		countEl.textContent = noteCount.toString();
		
		// Add non-interactive chevron for aesthetic consistency
		const chevronContainer = rootHeader.createEl('span', { cls: 'folder-chevron-container non-clickable' });
		const chevron = this.getChevronIcon(false);
		chevron.addClass('non-interactive');
		chevronContainer.appendChild(chevron);
		
		// Store element references for updates (no children for root)
		this.folderElements.set(rootFolder.path, {
			container: rootEl,
			header: rootHeader,
			icon: folderIconContainer,
			count: countEl,
			chevron: chevronContainer
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
		
		const folderHeader = folderEl.createEl('div', { cls: 'folder-header' });
		
		// Add click handler for folder header (not chevron)
		folderHeader.addEventListener('click', (e) => {
			// Prevent if clicking chevron
			const target = e.target as HTMLElement;
			if (target && !target.closest('.folder-chevron-container')) {
				this.containerManager.openContainer(folder);
			}
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
			subfolders.sort((a, b) => a.name.localeCompare(b.name));
			
			for (const subfolder of subfolders) {
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
				subfolders.sort((a, b) => a.name.localeCompare(b.name));
				
				const depth = (elements.container.style.paddingLeft.replace('px', '') as any) / 16 + 1;
				for (const subfolder of subfolders) {
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
			this.updateCountsForAffectedFolders(affectedFolders);
		} else if (file instanceof TFolder) {
			// For new folders, we need a full refresh
			this.refreshView();
		}
	}

	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void {
		if (file instanceof TFile) {
			this.updateCountsForAffectedFolders(affectedFolders);
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
			this.updateCountsForAffectedFolders(affectedFolders);
		}
	}

	handleFileModify(file: TAbstractFile, affectedFolders: string[]): void {
		// Only handle folder structure modifications
		if (file instanceof TFolder) {
			this.updateCountsForAffectedFolders(affectedFolders);
		}
	}

	private updateCountsForAffectedFolders(affectedFolders: string[]): void {
		// Recalculate counts
		this.calculateFolderCounts();
		
		// Update counts for all affected folders
		for (const folderPath of affectedFolders) {
			const newCount = this.folderCounts.get(folderPath) || 0;
			this.updateFolderCount(folderPath, newCount);
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
		const folderName = await this.promptForFolderName();
		if (!folderName) return;

		// Create folder in root directory
		const folderPath = folderName;
		
		try {
			await this.app.vault.createFolder(folderPath);
			// The VaultObserver will handle updating the UI automatically
		} catch (error) {
			console.error('Failed to create folder:', error);
			// Show error to user if folder creation fails
			new Notice(`Failed to create folder: ${error.message}`);
		}
	}

	private async promptForFolderName(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new FolderNameModal(this.app, (result) => {
				resolve(result);
			});
			modal.open();
		});
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
}

class FolderNameModal extends Modal {
	private result: string | null = null;
	private onSubmit: (result: string | null) => void;

	constructor(app: App, onSubmit: (result: string | null) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create New Folder' });

		const inputContainer = contentEl.createDiv();
		const input = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Folder name...'
		});
		input.style.width = '100%';
		input.style.padding = '8px';
		input.style.marginBottom = '16px';
		input.style.border = '1px solid var(--background-modifier-border)';
		input.style.borderRadius = '4px';
		input.style.backgroundColor = 'var(--background-primary)';
		input.style.color = 'var(--text-normal)';

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.justifyContent = 'flex-end';

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.style.padding = '8px 16px';
		cancelBtn.style.border = '1px solid var(--background-modifier-border)';
		cancelBtn.style.borderRadius = '4px';
		cancelBtn.style.backgroundColor = 'var(--background-secondary)';
		cancelBtn.style.color = 'var(--text-normal)';
		cancelBtn.style.cursor = 'pointer';

		const createBtn = buttonContainer.createEl('button', { text: 'Create' });
		createBtn.style.padding = '8px 16px';
		createBtn.style.border = 'none';
		createBtn.style.borderRadius = '4px';
		createBtn.style.backgroundColor = 'var(--interactive-accent)';
		createBtn.style.color = 'var(--text-on-accent)';
		createBtn.style.cursor = 'pointer';

		// Event handlers
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.submit();
			} else if (e.key === 'Escape') {
				this.close();
			}
		});

		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		createBtn.addEventListener('click', () => {
			this.submit();
		});

		// Focus input
		input.focus();
	}

	private submit() {
		const input = this.contentEl.querySelector('input') as HTMLInputElement;
		const value = input.value.trim();
		
		if (value) {
			// Basic validation
			if (value.includes('/') || value.includes('\\')) {
				new Notice('Folder name cannot contain slashes');
				return;
			}
			
			this.result = value;
		}
		
		this.close();
	}

	onClose() {
		this.onSubmit(this.result);
	}
}