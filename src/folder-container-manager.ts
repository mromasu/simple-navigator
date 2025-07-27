import { App, TFolder, TFile, TAbstractFile, Vault } from 'obsidian';
import MyPlugin from './main';

export class FolderContainerManager {
	private app: App;
	private plugin: MyPlugin;
	private container: HTMLElement | null = null;
	private currentFolder: TFolder | null = null;
	private resizeHandle: HTMLElement | null = null;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartWidth = 0;

	constructor(app: App, plugin: MyPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.bindEvents();
	}

	private bindEvents(): void {
		// Handle escape key to close container
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.container) {
				this.closeContainer();
			}
		});

	}

	openContainer(folder: TFolder): void {
		// Close existing container if any
		this.closeContainer();

		this.currentFolder = folder;
		this.createContainer();
	}

	closeContainer(): void {
		if (this.container) {
			this.container.remove();
			this.container = null;
			this.currentFolder = null;
			this.resizeHandle = null;
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
		if (!file.parent?.isRoot()) {
			const folder = meta.createEl('span', { cls: 'file-item-folder' });
			folder.innerHTML = `📁 ${file.parent?.name || 'Notes'}`;
		}
		
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
}