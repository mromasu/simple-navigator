import { FileView, WorkspaceLeaf, TFolder, TFile, TAbstractFile, Vault, Notice, Menu, Platform } from 'obsidian';
import { VaultObserver, VaultUpdateHandler } from './vault-observer';
import { TextInputModal } from './navigator-view';
import MyPlugin from './main';

export const MOBILE_NAVIGATOR_VIEW_TYPE = 'mobile-navigator-view';

enum ViewState {
	FOLDER_VIEW = 'folder',
	FILE_VIEW = 'file'
}

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

interface FolderElements {
	container: HTMLElement;
	header: HTMLElement;
	icon: HTMLElement;
	chevron?: HTMLElement;
	count: HTMLElement;
	children?: HTMLElement;
}

export class MobileNavigatorView extends FileView implements VaultUpdateHandler {
	private plugin: MyPlugin;
	private currentState: ViewState = ViewState.FOLDER_VIEW;
	private currentFolder: TFolder | null = null;
	private isAllNotesMode: boolean = false;
	
	// Folder navigation state
	private expandedFolders: Set<string> = new Set();
	private folderCounts: Map<string, number> = new Map();
	private rootOnlyCount: number = 0;
	private folderElements: Map<string, FolderElements> = new Map();
	
	// File container state
	private fileElements: Map<string, FileItemElements> = new Map();
	private groupElements: Map<string, GroupElements> = new Map();
	private fileImageCache: Map<string, string | null> = new Map();

	allowNoFile = true;

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MOBILE_NAVIGATOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Mobile Navigator';
	}

	getIcon(): string {
		return 'navigation';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl;
		container.empty();
		container.addClass('mobile-navigator-view');
		
		// Open All Notes file view by default
		this.switchToFileView('ALL_NOTES');
		
		// Register with VaultObserver
		VaultObserver.getInstance(this.app).registerView(this);
	}

	async onClose(): Promise<void> {
		// Unregister from VaultObserver
		VaultObserver.getInstance(this.app).unregisterView(this);
		this.cleanup();
	}

	private cleanup(): void {
		this.fileElements.clear();
		this.groupElements.clear();
		this.fileImageCache.clear();
		this.folderElements.clear();
	}

	private renderView(): void {
		const container = this.containerEl;
		container.empty();
		
		// Create header
		const header = container.createEl('div', { cls: 'mobile-nav-header' });
		this.renderHeader(header);
		
		// Create content area
		const content = container.createEl('div', { cls: 'mobile-nav-content' });
		
		if (this.currentState === ViewState.FOLDER_VIEW) {
			this.renderFolderView(content);
		} else {
			this.renderFileView(content);
		}
	}

	private renderHeader(header: HTMLElement): void {
		if (this.currentState === ViewState.FOLDER_VIEW) {
			// Folder view header
			const title = header.createEl('span', { cls: 'mobile-nav-title' });
			title.textContent = 'Folders';
			
			const createFolderBtn = header.createEl('button', { cls: 'mobile-nav-action-btn' });
			createFolderBtn.textContent = '+';
			createFolderBtn.title = 'Create new folder';
			createFolderBtn.addEventListener('click', () => this.createNewFolder());
		} else {
			// File view header
			const backBtn = header.createEl('button', { cls: 'mobile-nav-back-btn' });
			backBtn.textContent = '← Folders';
			backBtn.addEventListener('click', () => this.switchToFolderView());
			
			const title = header.createEl('span', { cls: 'mobile-nav-title' });
			if (this.isAllNotesMode) {
				title.textContent = 'All Notes';
			} else if (this.currentFolder?.isRoot()) {
				title.textContent = 'Notes';
			} else {
				title.textContent = this.currentFolder?.name || 'Notes';
			}
			
			const createNoteBtn = header.createEl('button', { cls: 'mobile-nav-action-btn' });
			createNoteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>';
			createNoteBtn.title = 'Create new note';
			createNoteBtn.addEventListener('click', () => this.createNewNote());
		}
	}

	private renderFolderView(content: HTMLElement): void {
		this.calculateFolderCounts();
		
		const rootFolder = this.app.vault.getRoot();
		
		// Render "All Notes" at the top
		this.renderAllNotesItem(content);
		
		// Render root folder as clickable item
		this.renderRootItem(rootFolder, content);
		
		// Render root's subfolders
		const subfolders = rootFolder.children
			.filter(child => child instanceof TFolder) as TFolder[];
		const visibleSubfolders = subfolders.filter(folder => !this.isHidden(folder.path));
		
		// Sort with pinned folders first, then alphabetically
		visibleSubfolders.sort((a, b) => {
			const aIsPinned = this.plugin.isPathPinned(a.path, 'folder');
			const bIsPinned = this.plugin.isPathPinned(b.path, 'folder');
			
			if (aIsPinned && !bIsPinned) return -1;
			if (!aIsPinned && bIsPinned) return 1;
			return a.name.localeCompare(b.name);
		});
		
		for (const subfolder of visibleSubfolders) {
			this.renderFolderItem(subfolder, content, 0);
		}
	}

	private renderAllNotesItem(container: HTMLElement): void {
		const item = container.createEl('div', { cls: 'mobile-folder-item all-notes-item' });
		
		const header = item.createEl('div', { cls: 'mobile-folder-header' });
		header.addEventListener('click', () => this.switchToFileView('ALL_NOTES'));
		
		const icon = this.createFolderIcon(false, false);
		icon.addClass('all-notes-icon');
		header.appendChild(icon);
		
		const name = header.createEl('span', { cls: 'mobile-folder-name' });
		name.textContent = 'All Notes';
		
		const count = header.createEl('span', { cls: 'mobile-folder-count' });
		count.textContent = this.getTotalFileCount().toString();
		
		const chevron = header.createEl('span', { cls: 'mobile-folder-chevron' });
		chevron.textContent = '›';
	}

	private renderRootItem(rootFolder: TFolder, container: HTMLElement): void {
		const item = container.createEl('div', { cls: 'mobile-folder-item root-item' });
		
		const header = item.createEl('div', { cls: 'mobile-folder-header' });
		header.addEventListener('click', () => this.switchToFileView(rootFolder));
		
		// Context menu
		header.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFolderContextMenu(e, rootFolder);
		});
		
		const icon = this.createFolderIcon(false, true);
		header.appendChild(icon);
		
		const name = header.createEl('span', { cls: 'mobile-folder-name' });
		name.textContent = 'Notes';
		
		const count = header.createEl('span', { cls: 'mobile-folder-count' });
		count.textContent = this.rootOnlyCount.toString();
		
		const chevron = header.createEl('span', { cls: 'mobile-folder-chevron' });
		chevron.textContent = '›';
		
		// Store elements for updates
		this.folderElements.set(rootFolder.path, {
			container: item,
			header: header,
			icon: header.querySelector('.mobile-folder-icon') as HTMLElement,
			count: count
		});
	}

	private renderFolderItem(folder: TFolder, parent: HTMLElement, depth: number): void {
		const item = parent.createEl('div', { cls: 'mobile-folder-item' });
		item.style.paddingLeft = `${depth * 16 + 16}px`;
		
		if (this.plugin.isPathPinned(folder.path, 'folder')) {
			item.addClass('pinned');
		}
		
		const header = item.createEl('div', { cls: 'mobile-folder-header' });
		
		// Click handler to switch to file view
		header.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.mobile-folder-expand')) {
				this.switchToFileView(folder);
			}
		});
		
		// Context menu
		header.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFolderContextMenu(e, folder);
		});
		
		const hasChildren = folder.children.some(child => child instanceof TFolder);
		const isExpanded = this.expandedFolders.has(folder.path);
		
		// Expand/collapse button (if has children)
		if (hasChildren) {
			const expandBtn = header.createEl('button', { cls: 'mobile-folder-expand' });
			expandBtn.textContent = isExpanded ? '▼' : '▶';
			expandBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleFolder(folder.path);
			});
		}
		
		const icon = this.createFolderIcon(isExpanded, hasChildren);
		header.appendChild(icon);
		
		const name = header.createEl('span', { cls: 'mobile-folder-name' });
		name.textContent = folder.name;
		
		const count = header.createEl('span', { cls: 'mobile-folder-count' });
		count.textContent = (this.folderCounts.get(folder.path) || 0).toString();
		
		const chevron = header.createEl('span', { cls: 'mobile-folder-chevron' });
		chevron.textContent = '›';
		
		// Children container
		let childrenContainer: HTMLElement | undefined;
		if (hasChildren) {
			childrenContainer = item.createEl('div', { cls: 'mobile-folder-children' });
			
			if (isExpanded) {
				const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
				const visibleSubfolders = subfolders.filter(subfolder => !this.isHidden(subfolder.path));
				
				visibleSubfolders.sort((a, b) => {
					const aIsPinned = this.plugin.isPathPinned(a.path, 'folder');
					const bIsPinned = this.plugin.isPathPinned(b.path, 'folder');
					
					if (aIsPinned && !bIsPinned) return -1;
					if (!aIsPinned && bIsPinned) return 1;
					return a.name.localeCompare(b.name);
				});
				
				for (const subfolder of visibleSubfolders) {
					this.renderFolderItem(subfolder, childrenContainer, depth + 1);
				}
			}
		}
		
		// Store elements for updates
		this.folderElements.set(folder.path, {
			container: item,
			header: header,
			icon: header.querySelector('.mobile-folder-icon') as HTMLElement,
			count: count,
			children: childrenContainer
		});
	}

	private async renderFileView(content: HTMLElement): Promise<void> {
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

	private switchToFolderView(): void {
		this.currentState = ViewState.FOLDER_VIEW;
		this.currentFolder = null;
		this.isAllNotesMode = false;
		this.renderView();
	}

	private switchToFileView(target: TFolder | 'ALL_NOTES'): void {
		this.currentState = ViewState.FILE_VIEW;
		
		if (target === 'ALL_NOTES') {
			this.isAllNotesMode = true;
			this.currentFolder = this.app.vault.getRoot();
		} else {
			this.isAllNotesMode = false;
			this.currentFolder = target;
		}
		
		this.renderView();
	}

	private toggleFolder(folderPath: string): void {
		const isExpanded = this.expandedFolders.has(folderPath);
		
		if (isExpanded) {
			this.expandedFolders.delete(folderPath);
		} else {
			this.expandedFolders.add(folderPath);
		}
		
		this.updateFolderExpansion(folderPath, !isExpanded);
	}

	private updateFolderExpansion(folderPath: string, isExpanded: boolean): void {
		const elements = this.folderElements.get(folderPath);
		if (!elements) return;
		
		const expandBtn = elements.header.querySelector('.mobile-folder-expand') as HTMLElement;
		if (expandBtn) {
			expandBtn.textContent = isExpanded ? '▼' : '▶';
		}
		
		// Update folder icon
		const folder = this.app.vault.getFolderByPath(folderPath);
		if (!folder) return;
		
		const hasChildren = folder.children.some(child => child instanceof TFolder);
		const newIcon = this.createFolderIcon(isExpanded, hasChildren);
		elements.icon.empty();
		elements.icon.appendChild(newIcon);
		
		// Manage children container
		if (elements.children) {
			if (isExpanded && elements.children.children.length === 0) {
				// Render children
				const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
				const visibleSubfolders = subfolders.filter(subfolder => !this.isHidden(subfolder.path));
				
				visibleSubfolders.sort((a, b) => {
					const aIsPinned = this.plugin.isPathPinned(a.path, 'folder');
					const bIsPinned = this.plugin.isPathPinned(b.path, 'folder');
					
					if (aIsPinned && !bIsPinned) return -1;
					if (!aIsPinned && bIsPinned) return 1;
					return a.name.localeCompare(b.name);
				});
				
				const currentDepth = parseInt(elements.container.style.paddingLeft.replace('px', '')) / 16;
				for (const subfolder of visibleSubfolders) {
					this.renderFolderItem(subfolder, elements.children, currentDepth);
				}
			}
			
			// Toggle visibility
			elements.children.style.display = isExpanded ? 'block' : 'none';
		}
	}

	// File management methods (adapted from FolderContainerManager)
	private getFiles(): TFile[] {
		if (!this.currentFolder) return [];

		const files: TFile[] = [];

		if (this.isAllNotesMode) {
			Vault.recurseChildren(this.app.vault.getRoot(), (file: TAbstractFile) => {
				if (file instanceof TFile) {
					files.push(file);
				}
			});
		} else if (this.currentFolder.isRoot()) {
			for (const child of this.currentFolder.children) {
				if (child instanceof TFile) {
					files.push(child);
				}
			}
		} else {
			Vault.recurseChildren(this.currentFolder, (file: TAbstractFile) => {
				if (file instanceof TFile) {
					files.push(file);
				}
			});
		}

		const visibleFiles = files.filter(file => !this.isFileHidden(file.path));
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
		const group = content.createEl('div', { cls: 'mobile-file-group' });
		
		const header = group.createEl('h3', { cls: 'mobile-file-group-header' });
		if (groupName === 'Pinned') {
			header.addClass('pinned-header');
		}
		header.textContent = groupName;
		
		const container = group.createEl('div', { cls: 'mobile-file-group-container' });
		
		this.groupElements.set(groupName, {
			container: group,
			header: header,
			groupContainer: container
		});
		
		for (let i = 0; i < files.length; i++) {
			await this.renderFileItem(container, files[i]);
			
			if (i < files.length - 1) {
				container.createEl('div', { cls: 'mobile-file-divider' });
			}
		}
	}

	private async renderFileItem(container: HTMLElement, file: TFile): Promise<void> {
		const item = container.createEl('div', { cls: 'mobile-file-item' });
		
		if (this.plugin.isPathPinned(file.path, 'file')) {
			item.addClass('pinned');
		}
		
		const itemContent = item.createEl('div', { cls: 'mobile-file-content' });
		
		const fileName = itemContent.createEl('div', { cls: 'mobile-file-title' });
		fileName.textContent = file.basename;
		
		const preview = itemContent.createEl('div', { cls: 'mobile-file-preview' });
		
		let meta: HTMLElement | undefined;
		let folderBadge: HTMLElement | undefined;
		
		const shouldShowFolderBadge = (this.isAllNotesMode || !this.currentFolder?.isRoot()) &&
			!file.parent?.isRoot() && 
			(this.isAllNotesMode || file.parent !== this.currentFolder);
		
		if (shouldShowFolderBadge) {
			meta = itemContent.createEl('div', { cls: 'mobile-file-meta' });
			folderBadge = meta.createEl('span', { cls: 'mobile-file-folder' });
			const breadcrumbPath = this.generateBreadcrumbPath(file);
			folderBadge.innerHTML = `📁 ${breadcrumbPath}`;
		}
		
		const imageContainer = item.createEl('div', { cls: 'mobile-file-image' });
		
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
		
		// Context menu
		item.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showFileContextMenu(e, file);
		});
		
		// Load content and image
		await this.loadFileContent(file, preview, imageContainer);
	}

	// Utility methods (adapted from existing classes)
	private createFolderIcon(isExpanded: boolean, hasChildren: boolean): HTMLElement {
		const iconContainer = document.createElement('span');
		iconContainer.addClass('mobile-folder-icon');
		
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		if (hasChildren && isExpanded) {
			path.setAttribute('d', 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2');
		} else {
			path.setAttribute('d', 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z');
		}
		svg.appendChild(path);
		iconContainer.appendChild(svg);
		
		return iconContainer;
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

	// File content methods (from FolderContainerManager)
	private async loadFileContent(file: TFile, previewElement: HTMLElement, imageElement: HTMLElement): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			
			const firstImage = this.extractFirstImage(content);
			this.fileImageCache.set(file.path, firstImage);
			
			const preview = this.sanitizeContent(content);
			previewElement.textContent = preview || 'No preview available';
			
			if (firstImage) {
				imageElement.removeClass('loading', 'error', 'retry');
				await this.setImagePreviewWithRetry(imageElement, file, firstImage);
			} else {
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

	private async setImagePreviewWithRetry(element: HTMLElement, file: TFile, imagePath: string, attempt: number = 1): Promise<void> {
		const MAX_RETRIES = 3;
		const BASE_DELAY = 100;
		
		try {
			element.style.display = 'block';
			element.addClass('loading');
			
			let resolvedPath: string;
			
			if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
				resolvedPath = imagePath;
			} else if (imagePath.startsWith('/')) {
				resolvedPath = imagePath;
			} else {
				let imageFile: TFile | null = null;
				
				const directFile = this.app.vault.getAbstractFileByPath(imagePath);
				if (directFile instanceof TFile) {
					imageFile = directFile;
				} else if (file.parent) {
					const relativeFile = this.app.vault.getAbstractFileByPath(`${file.parent.path}/${imagePath}`);
					if (relativeFile instanceof TFile) {
						imageFile = relativeFile;
					}
				}
				
				if (!imageFile) {
					const allFiles = this.app.vault.getFiles();
					imageFile = allFiles.find(f => f.name === imagePath || f.path.endsWith(`/${imagePath}`)) || null;
				}
				
				if (imageFile) {
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
					element.style.display = 'none';
					element.removeClass('loading');
					return;
				}
			}
			
			element.empty();
			const img = element.createEl('img');
			img.style.width = '100%';
			img.style.height = '100%';
			img.style.objectFit = 'cover';
			img.style.borderRadius = '4px';
			
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Image load timeout'));
				}, 5000);
				
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
			
			if (attempt < MAX_RETRIES) {
				const delay = BASE_DELAY * Math.pow(2, attempt - 1);
				element.addClass('retry');
				
				setTimeout(() => {
					element.removeClass('retry');
					this.setImagePreviewWithRetry(element, file, imagePath, attempt + 1);
				}, delay);
			} else {
				element.addClass('error');
				
				setTimeout(() => {
					element.removeClass('error');
					element.style.display = 'none';
				}, 2000);
			}
		}
	}

	private extractFirstImage(content: string): string | null {
		const frontmatterImage = this.extractFrontmatterImage(content);
		if (frontmatterImage) {
			return frontmatterImage;
		}

		const withoutFrontmatter = content.replace(/^---[\s\S]*?---\n?/m, '');
		
		const markdownImageMatch = withoutFrontmatter.match(/!\[([^\]]*)\]\(([^)]+)\)/);
		if (markdownImageMatch) {
			return markdownImageMatch[2];
		}
		
		const wikiImageMatch = withoutFrontmatter.match(/!\[\[([^|\]]+)(?:\|[^\]]*)?]\]/);
		if (wikiImageMatch) {
			return wikiImageMatch[1];
		}
		
		const htmlImageMatch = withoutFrontmatter.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
		if (htmlImageMatch) {
			return htmlImageMatch[1];
		}
		
		return null;
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

	private isValidImageUrl(url: string): boolean {
		const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico'];
		const urlLower = url.toLowerCase();
		return imageExtensions.some(ext => urlLower.endsWith(ext));
	}

	private sanitizeContent(content: string): string {
		let sanitized = content;

		sanitized = sanitized.replace(/^---[\s\S]*?---\n?/m, '');
		sanitized = sanitized.replace(/<[^>]*>/g, '');
		sanitized = sanitized.replace(/^#{1,6}\s+.*$/gm, '');
		sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
		sanitized = sanitized.replace(/`[^`]*`/g, '');
		sanitized = sanitized.replace(/!\[\[.*?\]\]/g, '');
		sanitized = sanitized.replace(/\[\[.*?\]\]/g, '');
		sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
		sanitized = sanitized.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
		sanitized = sanitized.replace(/\*\*([^*]*)\*\*/g, '$1');
		sanitized = sanitized.replace(/\*([^*]*)\*/g, '$1');
		sanitized = sanitized.replace(/__([^_]*)__/g, '$1');
		sanitized = sanitized.replace(/_([^_]*)_/g, '$1');
		sanitized = sanitized.replace(/~~([^~]*)~~/g, '$1');
		sanitized = sanitized.replace(/^[\s]*[-*+]\s+/gm, '');
		sanitized = sanitized.replace(/^[\s]*\d+\.\s+/gm, '');
		sanitized = sanitized.replace(/^>\s*/gm, '');
		sanitized = sanitized.replace(/-{2,}>/g, '');
		sanitized = sanitized.replace(/->/g, '');
		sanitized = sanitized.replace(/<-+/g, '');
		sanitized = sanitized.replace(/={2,}>/g, '');
		sanitized = sanitized.replace(/=>/g, '');
		sanitized = sanitized.replace(/^-{3,}$/gm, '');
		sanitized = sanitized.replace(/^={3,}$/gm, '');
		sanitized = sanitized.replace(/^\*{3,}$/gm, '');
		sanitized = sanitized.replace(/^_{3,}$/gm, '');
		sanitized = sanitized.replace(/\|/g, ' ');
		sanitized = sanitized.replace(/\n\s*\n/g, ' ');
		sanitized = sanitized.replace(/\s+/g, ' ');
		sanitized = sanitized.trim();

		return sanitized.substring(0, 100);
	}

	private generateBreadcrumbPath(file: TFile): string {
		if (!file.parent || file.parent.isRoot()) {
			return 'Notes';
		}

		const pathParts: string[] = [];
		let currentFolder: TFolder | null = file.parent;
		
		while (currentFolder && !currentFolder.isRoot()) {
			if (!this.isAllNotesMode && this.currentFolder && currentFolder === this.currentFolder) {
				break;
			}
			pathParts.unshift(currentFolder.name);
			currentFolder = currentFolder.parent;
		}

		if (pathParts.length === 0) {
			return 'Notes';
		}

		const truncatedParts = pathParts.map((part, index) => {
			if (index === pathParts.length - 1) {
				return part;
			} else {
				return part.length > 3 ? part.substring(0, 3) : part;
			}
		});

		return truncatedParts.join('/');
	}

	// Context menu methods
	private showFolderContextMenu(event: MouseEvent, folder: TFolder): void {
		const menu = new Menu();
		
		menu.addItem((item) => {
			item.setTitle('New note')
				.setIcon('file-plus')
				.onClick(() => this.createNewFileInFolder(folder));
		});

		menu.addItem((item) => {
			item.setTitle('New folder')
				.setIcon('folder-plus')
				.onClick(() => this.createNewFolderInFolder(folder));
		});

		menu.addSeparator();

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

		if (folder.path !== '') {
			menu.addItem((item) => {
				item.setTitle('Rename')
					.setIcon('pencil')
					.onClick(() => this.renameFolderPrompt(folder));
			});

			menu.addItem((item) => {
				item.setTitle('Delete folder')
					.setIcon('trash')
					.onClick(() => this.deleteFolderPrompt(folder));
			});
		}

		menu.showAtMouseEvent(event);
	}

	private showFileContextMenu(event: MouseEvent, file: TFile): void {
		const menu = new Menu();
		
		menu.addItem((item) => {
			item.setTitle('Open in new tab')
				.setIcon('external-link')
				.onClick(() => {
					this.app.workspace.getLeaf('tab').openFile(file);
				});
		});

		menu.addItem((item) => {
			item.setTitle('Open in new pane')
				.setIcon('separator-vertical')
				.onClick(() => {
					this.app.workspace.getLeaf('split', 'vertical').openFile(file);
				});
		});

		menu.addSeparator();

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
					if (this.currentState === ViewState.FILE_VIEW) {
						await this.refreshFileView();
					}
				});
		});

		menu.addItem((item) => {
			item.setTitle('Rename')
				.setIcon('pencil')
				.onClick(() => this.renameFilePrompt(file));
		});

		menu.addItem((item) => {
			item.setTitle('Delete')
				.setIcon('trash')
				.onClick(() => this.deleteFilePrompt(file));
		});

		menu.showAtMouseEvent(event);
	}

	// Creation methods
	private async createNewFolder(): Promise<void> {
		const nextNumber = this.getNextUntitledFolderNumber();
		const folderName = nextNumber === 0 ? 'Untitled' : `Untitled ${nextNumber}`;
		
		try {
			await this.app.vault.createFolder(folderName);
		} catch (error) {
			console.error('Failed to create folder:', error);
			new Notice(`Failed to create folder: ${error.message}`);
		}
	}

	private async createNewNote(): Promise<void> {
		if (!this.currentFolder) return;
		
		try {
			let targetFolder: TFolder;
			
			if (this.isAllNotesMode) {
				targetFolder = this.app.vault.getRoot();
			} else {
				targetFolder = this.currentFolder;
			}
			
			const nextNumber = this.getNextUntitledNumber(targetFolder);
			const fileName = nextNumber === 0 ? 'Untitled.md' : `Untitled ${nextNumber}.md`;
			const filePath = targetFolder.path ? `${targetFolder.path}/${fileName}` : fileName;
			
			const newFile = await this.app.vault.create(filePath, '');
			await this.app.workspace.openLinkText(newFile.path, '', false);
			
		} catch (error) {
			console.error('Failed to create new note:', error);
		}
	}

	private async createNewFileInFolder(folder: TFolder): Promise<void> {
		const fileName = 'Untitled.md';
		const filePath = folder.path ? `${folder.path}/${fileName}` : fileName;
		
		let finalPath = filePath;
		let counter = 1;
		while (await this.app.vault.adapter.exists(finalPath)) {
			const baseName = fileName.replace('.md', '');
			finalPath = folder.path ? `${folder.path}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`;
			counter++;
		}

		try {
			const file = await this.app.vault.create(finalPath, '');
			this.app.workspace.getLeaf().openFile(file);
		} catch (error) {
			console.error('Failed to create file:', error);
			new Notice(`Failed to create file: ${error.message}`);
		}
	}

	private async createNewFolderInFolder(folder: TFolder): Promise<void> {
		const folderName = 'New folder';
		const folderPath = folder.path ? `${folder.path}/${folderName}` : folderName;
		
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

	// Utility number generation
	private getNextUntitledFolderNumber(): number {
		const rootFolder = this.app.vault.getRoot();
		const folders = rootFolder.children.filter(child => child instanceof TFolder) as TFolder[];
		const untitledPattern = /^Untitled( (\d+))?$/;
		const existingNumbers: number[] = [];

		for (const folder of folders) {
			const match = folder.name.match(untitledPattern);
			if (match) {
				if (match[2]) {
					existingNumbers.push(parseInt(match[2], 10));
				} else {
					existingNumbers.push(0);
				}
			}
		}

		if (existingNumbers.length === 0) {
			return 0;
		}

		existingNumbers.sort((a, b) => a - b);
		
		for (let i = 0; i < existingNumbers.length; i++) {
			if (existingNumbers[i] !== i) {
				return i;
			}
		}
		
		return existingNumbers.length;
	}

	private getNextUntitledNumber(targetFolder: TFolder): number {
		const files = targetFolder.children.filter(child => child instanceof TFile) as TFile[];
		const untitledPattern = /^Untitled( (\d+))?\.md$/;
		const existingNumbers: number[] = [];

		for (const file of files) {
			const match = file.name.match(untitledPattern);
			if (match) {
				if (match[2]) {
					existingNumbers.push(parseInt(match[2], 10));
				} else {
					existingNumbers.push(0);
				}
			}
		}

		if (existingNumbers.length === 0) {
			return 0;
		}

		existingNumbers.sort((a, b) => a - b);
		
		for (let i = 0; i < existingNumbers.length; i++) {
			if (existingNumbers[i] !== i) {
				return i;
			}
		}
		
		return existingNumbers.length;
	}

	// Prompt methods
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

	// Refresh methods
	private refreshView(): void {
		if (this.currentState === ViewState.FOLDER_VIEW) {
			this.folderElements.clear();
			this.renderView();
		} else {
			this.refreshFileView();
		}
	}

	private async refreshFileView(): Promise<void> {
		this.fileElements.clear();
		this.groupElements.clear();
		this.fileImageCache.clear();
		this.renderView();
	}

	// Utility methods
	private isHidden(path: string): boolean {
		return this.plugin.isPathHidden(path, 'folder');
	}

	private isFileHidden(path: string): boolean {
		return this.plugin.isPathHidden(path, 'file');
	}

	// VaultUpdateHandler implementation
	handleFileCreate(file: TAbstractFile, affectedFolders: string[]): void {
		if (this.currentState === ViewState.FOLDER_VIEW) {
			if (file instanceof TFolder) {
				this.refreshView();
			} else {
				this.updateFolderCounts();
			}
		} else if (this.currentState === ViewState.FILE_VIEW && file instanceof TFile) {
			if (this.isFileInCurrentView(file)) {
				this.refreshFileView();
			}
		}
	}

	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void {
		if (this.currentState === ViewState.FOLDER_VIEW) {
			if (file instanceof TFolder) {
				this.folderElements.delete(file.path);
				this.refreshView();
			} else {
				this.updateFolderCounts();
			}
		} else if (this.currentState === ViewState.FILE_VIEW && file instanceof TFile) {
			if (this.isFileInCurrentView(file)) {
				this.refreshFileView();
			}
		}
	}

	handleFileRename(file: TAbstractFile, oldPath: string, affectedFolders: string[]): void {
		if (this.currentState === ViewState.FOLDER_VIEW) {
			if (file instanceof TFolder) {
				this.folderElements.delete(oldPath);
				this.refreshView();
			} else {
				this.updateFolderCounts();
			}
		} else if (this.currentState === ViewState.FILE_VIEW) {
			this.refreshFileView();
		}
	}

	handleFileModify(file: TAbstractFile, affectedFolders: string[]): void {
		if (this.currentState === ViewState.FILE_VIEW && file instanceof TFile) {
			if (this.isFileInCurrentView(file)) {
				this.refreshFileView();
			}
		}
	}

	private isFileInCurrentView(file: TFile): boolean {
		if (!this.currentFolder) return false;
		
		if (this.isAllNotesMode) {
			return true;
		} else if (this.currentFolder.isRoot()) {
			return true;
		} else {
			return file.path.startsWith(this.currentFolder.path + '/');
		}
	}

	private updateFolderCounts(): void {
		this.calculateFolderCounts();
		
		// Update All Notes count
		const allNotesCountEl = this.containerEl.querySelector('.mobile-folder-count');
		if (allNotesCountEl) {
			allNotesCountEl.textContent = this.getTotalFileCount().toString();
		}
		
		// Update folder counts
		for (const [folderPath, elements] of this.folderElements.entries()) {
			const newCount = folderPath === this.app.vault.getRoot().path ? 
				this.rootOnlyCount : 
				(this.folderCounts.get(folderPath) || 0);
			elements.count.textContent = newCount.toString();
		}
	}
}