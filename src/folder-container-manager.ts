import { App, TFolder } from 'obsidian';
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
}