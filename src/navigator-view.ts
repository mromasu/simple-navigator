import { ItemView, WorkspaceLeaf, TFolder, TFile, TAbstractFile } from 'obsidian';

export const NAVIGATOR_VIEW_TYPE = 'navigator-view';

export class NavigatorView extends ItemView {
	private expandedFolders: Set<string> = new Set();
	private folderCounts: Map<string, number> = new Map();

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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
		title.textContent = 'Folders';
		
		const treeContainer = container.createEl('div', { cls: 'folder-tree' });
		this.renderFolderTree(treeContainer);
		
		this.registerVaultEvents();
	}

	async onClose(): Promise<void> {
		// Clean up if needed
	}

	private renderFolderTree(container: HTMLElement): void {
		this.calculateFolderCounts();
		
		const rootFolder = this.app.vault.getRoot();
		this.renderFolder(rootFolder, container, 0);
	}

	private renderFolder(folder: TFolder, parent: HTMLElement, depth: number): void {
		const folderEl = parent.createEl('div', { cls: 'folder-item' });
		folderEl.style.paddingLeft = `${depth * 16}px`;
		
		const folderHeader = folderEl.createEl('div', { cls: 'folder-header' });
		
		const hasChildren = folder.children.some(child => child instanceof TFolder);
		const isExpanded = this.expandedFolders.has(folder.path);
		
		if (hasChildren) {
			const chevron = folderHeader.createEl('span', { 
				cls: `folder-chevron ${isExpanded ? 'expanded' : 'collapsed'}` 
			});
			chevron.innerHTML = isExpanded ? '▼' : '▶';
			chevron.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleFolder(folder.path);
			});
		} else {
			folderHeader.createEl('span', { cls: 'folder-spacer' });
		}
		
		const folderIcon = folderHeader.createEl('span', { cls: 'folder-icon' });
		folderIcon.innerHTML = '📁';
		
		const folderName = folderHeader.createEl('span', { cls: 'folder-name' });
		folderName.textContent = folder.name || '/';
		
		const noteCount = this.folderCounts.get(folder.path) || 0;
		const countEl = folderHeader.createEl('span', { cls: 'folder-count' });
		countEl.textContent = noteCount.toString();
		
		if (hasChildren && isExpanded) {
			const childrenContainer = folderEl.createEl('div', { cls: 'folder-children' });
			const subfolders = folder.children.filter(child => child instanceof TFolder) as TFolder[];
			subfolders.sort((a, b) => a.name.localeCompare(b.name));
			
			for (const subfolder of subfolders) {
				this.renderFolder(subfolder, childrenContainer, depth + 1);
			}
		}
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

	private toggleFolder(folderPath: string): void {
		if (this.expandedFolders.has(folderPath)) {
			this.expandedFolders.delete(folderPath);
		} else {
			this.expandedFolders.add(folderPath);
		}
		
		const container = this.containerEl.querySelector('.folder-tree');
		if (container) {
			container.empty();
			this.renderFolderTree(container as HTMLElement);
		}
	}

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on('create', () => {
				this.refreshView();
			})
		);
		
		this.registerEvent(
			this.app.vault.on('delete', () => {
				this.refreshView();
			})
		);
		
		this.registerEvent(
			this.app.vault.on('rename', () => {
				this.refreshView();
			})
		);
	}

	private refreshView(): void {
		const container = this.containerEl.querySelector('.folder-tree');
		if (container) {
			container.empty();
			this.renderFolderTree(container as HTMLElement);
		}
	}
}