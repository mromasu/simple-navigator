import { App, TFolder, TFile, TAbstractFile, Vault } from 'obsidian';
import { VaultObserver, VaultUpdateHandler } from './vault-observer';
import MyPlugin from './main';

interface FileItemElements {
	container: HTMLElement;
	content: HTMLElement;
	title: HTMLElement;
	preview: HTMLElement;
	meta: HTMLElement;
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
	private container: HTMLElement | null = null;
	private currentFolder: TFolder | null = null;
	private resizeHandle: HTMLElement | null = null;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartWidth = 0;
	private fileElements: Map<string, FileItemElements> = new Map();
	private groupElements: Map<string, GroupElements> = new Map();

	constructor(app: App, plugin: MyPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.bindEvents();
	}

	private bindEvents(): void {
		// Only close button closes the container - no ESC key
	}

	openContainer(folder: TFolder): void {
		// Close existing container if any
		this.closeContainer();

		this.currentFolder = folder;
		this.createContainer();
		
		// Register with VaultObserver for file system events
		VaultObserver.getInstance(this.app).registerView(this);
	}

	closeContainer(): void {
		if (this.container) {
			// Unregister from VaultObserver
			VaultObserver.getInstance(this.app).unregisterView(this);
			
			this.container.remove();
			this.container = null;
			this.currentFolder = null;
			this.resizeHandle = null;
			
			// Clear element tracking
			this.fileElements.clear();
			this.groupElements.clear();
		}
	}

	private createContainer(): void {
		if (!this.currentFolder) return;

		// Find the workspace element
		const workspace = document.querySelector('.app-container .horizontal-main-container .workspace');
		if (!workspace) return;

		// Create container element
		this.container = document.createElement('div');
		this.container.addClass('workspace-split', 'mod-horizontal', 'mod-sidedock', 'mod-left-extend');
		this.container.style.width = `${this.plugin.settings.folderContainerWidth}px`;

		// Create header
		const header = this.container.createEl('div', { cls: 'folder-container-header' });
		const title = header.createEl('h2', { cls: 'folder-container-title' });
		title.textContent = this.currentFolder.isRoot() ? 'Notes' : this.currentFolder.name;

		// Create close button
		const closeButton = header.createEl('button', { cls: 'folder-container-close' });
		closeButton.innerHTML = '×';
		closeButton.addEventListener('click', () => this.closeContainer());

		// Create content container
		const content = this.container.createEl('div', { cls: 'folder-container-content' });
		
		// Render file list
		this.renderFileList(content);

		// Create resize handle
		this.resizeHandle = this.container.createEl('div', { cls: 'resize-handle' });
		this.setupResizeHandle();

		// Insert as 3rd child in workspace
		const children = Array.from(workspace.children);
		if (children.length >= 2) {
			workspace.insertBefore(this.container, children[2] || null);
		} else {
			workspace.appendChild(this.container);
		}
	}

	private setupResizeHandle(): void {
		if (!this.resizeHandle || !this.container) return;

		this.resizeHandle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			this.startResize(e);
		});
	}

	private startResize(e: MouseEvent): void {
		if (!this.container) return;

		this.isDragging = true;
		this.dragStartX = e.clientX;
		this.dragStartWidth = this.container.offsetWidth;

		document.addEventListener('mousemove', this.handleResize);
		document.addEventListener('mouseup', this.stopResize);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	private handleResize = (e: MouseEvent): void => {
		if (!this.isDragging || !this.container) return;

		const deltaX = e.clientX - this.dragStartX;
		const newWidth = Math.max(200, Math.min(600, this.dragStartWidth + deltaX));
		
		this.container.style.width = `${newWidth}px`;
	};

	private stopResize = async (): Promise<void> => {
		if (!this.isDragging || !this.container) return;

		this.isDragging = false;
		const finalWidth = this.container.offsetWidth;

		// Save width to settings
		this.plugin.settings.folderContainerWidth = finalWidth;
		await this.plugin.saveSettings();

		document.removeEventListener('mousemove', this.handleResize);
		document.removeEventListener('mouseup', this.stopResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	};

	cleanup(): void {
		// Unregister from VaultObserver before closing
		if (this.container) {
			VaultObserver.getInstance(this.app).unregisterView(this);
		}
		this.closeContainer();
		// Remove event listeners would go here if we had stored references
	}

	private renderFileList(content: HTMLElement): void {
		if (!this.currentFolder) return;

		// Get files based on folder type
		const files = this.getFiles();
		
		// Group files by date
		const groupedFiles = this.groupFilesByDate(files);
		
		// Render each group
		for (const [groupName, groupFiles] of Object.entries(groupedFiles)) {
			if (groupFiles.length === 0) continue;
			
			this.renderFileGroup(content, groupName, groupFiles);
		}
	}

	private getFiles(): TFile[] {
		if (!this.currentFolder) return [];

		const files: TFile[] = [];

		if (this.currentFolder.isRoot()) {
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

		// Sort by modification time (newest first)
		return files.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	private groupFilesByDate(files: TFile[]): Record<string, TFile[]> {
		const groups: Record<string, TFile[]> = {
			'Today': [],
			'Yesterday': [],
		};

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

		for (const file of files) {
			const fileDate = new Date(file.stat.mtime);
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

	private renderFileGroup(content: HTMLElement, groupName: string, files: TFile[]): void {
		const group = content.createEl('div', { cls: 'file-list-group' });
		
		// Group header
		const header = group.createEl('h3', { cls: 'file-list-group-header' });
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
			this.renderFileItem(container, files[i]);
			
			// Add divider after each item except the last
			if (i < files.length - 1) {
				container.createEl('div', { cls: 'file-item-divider' });
			}
		}
	}

	private renderFileItem(container: HTMLElement, file: TFile): void {
		const item = container.createEl('div', { cls: 'file-item' });
		
		// Item content
		const itemContent = item.createEl('div', { cls: 'file-item-content' });
		
		// File name
		const fileName = itemContent.createEl('div', { cls: 'file-item-title' });
		fileName.textContent = file.basename;
		
		// File preview
		const preview = itemContent.createEl('div', { cls: 'file-item-preview' });
		this.setFilePreview(preview, file);
		
		// Item metadata
		const meta = item.createEl('div', { cls: 'file-item-meta' });
		
		// Folder badge (if not in root)
		let folderBadge: HTMLElement | undefined;
		if (!file.parent?.isRoot()) {
			folderBadge = meta.createEl('span', { cls: 'file-item-folder' });
			folderBadge.innerHTML = `📁 ${file.parent?.name || 'Notes'}`;
		}
		
		// Store file element references
		this.fileElements.set(file.path, {
			container: item,
			content: itemContent,
			title: fileName,
			preview: preview,
			meta: meta,
			folderBadge: folderBadge
		});
		
		// Click handler
		item.addEventListener('click', () => {
			this.app.workspace.openLinkText(file.path, '', false);
		});
	}

	private async setFilePreview(element: HTMLElement, file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const preview = this.sanitizeContent(content);
			
			element.textContent = preview || 'No preview available';
		} catch {
			element.textContent = 'No preview available';
		}
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
		sanitized = sanitized.replace(/\[\[.*?\]\]/g, ''); // Wiki links
		sanitized = sanitized.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // Markdown links
		sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]*\)/g, ''); // Images

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
		
		if (this.currentFolder.isRoot()) {
			// For root folder: check all files in vault
			return true;
		} else {
			// For specific folder: check if file is in this folder or its children
			let current = file.parent;
			while (current) {
				if (current === this.currentFolder) {
					return true;
				}
				current = current.parent;
			}
			return false;
		}
	}

	private isPathInCurrentFolder(path: string): boolean {
		if (!this.currentFolder) return false;
		
		if (this.currentFolder.isRoot()) {
			// For root folder: all paths are relevant
			return true;
		} else {
			// For specific folder: check if path starts with folder path
			return path.startsWith(this.currentFolder.path + '/') || path === this.currentFolder.path;
		}
	}

	private refreshFileList(): void {
		if (!this.container || !this.currentFolder) return;
		
		// Clear element tracking before full refresh
		this.fileElements.clear();
		this.groupElements.clear();
		
		const content = this.container.querySelector('.folder-container-content');
		if (content) {
			content.empty();
			this.renderFileList(content as HTMLElement);
		}
	}

	// Smart update methods for hybrid rendering
	private async updateFileItem(file: TFile): Promise<void> {
		const elements = this.fileElements.get(file.path);
		if (!elements) return;
		
		// Update title
		elements.title.textContent = file.basename;
		
		// Update preview
		await this.setFilePreview(elements.preview, file);
		
		// Update folder badge
		if (elements.folderBadge) {
			elements.folderBadge.remove();
			elements.folderBadge = undefined;
		}
		
		if (!file.parent?.isRoot()) {
			const folderBadge = elements.meta.createEl('span', { cls: 'file-item-folder' });
			folderBadge.innerHTML = `📁 ${file.parent?.name || 'Notes'}`;
			elements.folderBadge = folderBadge;
		}
	}

	private addFileItem(file: TFile, groupName: string): void {
		const groupElements = this.groupElements.get(groupName);
		if (!groupElements) {
			// Group doesn't exist, create it
			this.ensureGroupExists(groupName);
			return this.addFileItem(file, groupName);
		}
		
		// Get sorted position for the file
		const files = this.getFilesInGroup(groupName);
		files.push(file);
		files.sort((a, b) => b.stat.mtime - a.stat.mtime);
		
		const insertIndex = files.indexOf(file);
		const existingItems = Array.from(groupElements.groupContainer.querySelectorAll('.file-item'));
		
		// Create temporary container to render the file item
		const tempContainer = document.createElement('div');
		this.renderFileItem(tempContainer, file);
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
		const elements = this.fileElements.get(file.path);
		if (!elements) return;
		
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
		
		// Check if group is now empty and remove if needed
		const groupName = this.getTargetGroup(file);
		this.removeEmptyGroup(groupName);
	}

	private moveFileItem(file: TFile, oldGroupName: string, newGroupName: string): void {
		this.removeFileItem(file);
		this.addFileItem(file, newGroupName);
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
		const fileDate = new Date(file.stat.mtime);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
		const fileDateOnly = new Date(fileDate.getFullYear(), fileDate.getMonth(), fileDate.getDate());
		
		if (fileDateOnly.getTime() === today.getTime()) {
			return 'Today';
		} else if (fileDateOnly.getTime() === yesterday.getTime()) {
			return 'Yesterday';
		} else {
			return this.formatDateGroup(fileDate);
		}
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
			this.addFileItem(file, groupName);
		}
	}

	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void {
		if (!this.container || !this.currentFolder) return;
		
		// Only handle files that were in the current folder or its children
		if (!this.isFileInCurrentFolder(file)) return;
		
		if (file instanceof TFile) {
			this.removeFileItem(file);
		}
	}

	handleFileRename(file: TAbstractFile, oldPath: string, affectedFolders: string[]): void {
		if (!this.container || !this.currentFolder) return;
		
		// Check if file was or is now in current folder
		const wasInFolder = this.isPathInCurrentFolder(oldPath);
		const isInFolder = this.isFileInCurrentFolder(file);
		
		if (file instanceof TFile) {
			if (wasInFolder && isInFolder) {
				// File was renamed within current folder
				const oldGroupName = this.getTargetGroupFromPath(oldPath);
				const newGroupName = this.getTargetGroup(file);
				
				if (oldGroupName === newGroupName) {
					// Same group, just update the file item
					this.updateFileItem(file);
				} else {
					// Different group, move the file
					this.moveFileItem(file, oldGroupName, newGroupName);
				}
			} else if (wasInFolder && !isInFolder) {
				// File was moved out of current folder
				this.removeFileItem(file);
			} else if (!wasInFolder && isInFolder) {
				// File was moved into current folder
				const groupName = this.getTargetGroup(file);
				this.addFileItem(file, groupName);
			}
		}
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
				this.updateFileItem(file);
			} else {
				// Different group due to modification time change
				this.moveFileItem(file, currentGroupName, targetGroupName);
			}
		}
	}

	private getTargetGroupFromPath(filePath: string): string {
		// This is a simplified version - in a real implementation,
		// we'd need to get the modification time from the old file
		// For now, assume it stays in the same group
		const elements = this.fileElements.get(filePath);
		if (elements) {
			// Find which group this element belongs to
			for (const [groupName, groupElements] of this.groupElements.entries()) {
				if (groupElements.groupContainer.contains(elements.container)) {
					return groupName;
				}
			}
		}
		return 'Today'; // fallback
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
}