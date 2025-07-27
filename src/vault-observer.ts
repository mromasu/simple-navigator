import { App, TAbstractFile, TFile, TFolder, EventRef } from 'obsidian';

export interface VaultChange {
	type: 'create' | 'delete' | 'rename' | 'modify';
	file: TAbstractFile;
	oldPath?: string;
	affectedFolders: string[];
}

export interface VaultUpdateHandler {
	handleFileCreate(file: TAbstractFile, affectedFolders: string[]): void;
	handleFileDelete(file: TAbstractFile, affectedFolders: string[]): void;
	handleFileRename(file: TAbstractFile, oldPath: string, affectedFolders: string[]): void;
	handleFileModify(file: TAbstractFile, affectedFolders: string[]): void;
}

export class VaultObserver {
	private static instance: VaultObserver | null = null;
	private app: App;
	private views: Set<VaultUpdateHandler> = new Set();
	private eventRefs: EventRef[] = [];
	private pendingChanges: VaultChange[] = [];
	private debounceTimer: number | null = null;
	private readonly DEBOUNCE_DELAY = 100; // ms

	private constructor(app: App) {
		this.app = app;
		this.registerVaultEvents();
	}

	static getInstance(app: App): VaultObserver {
		if (!VaultObserver.instance) {
			VaultObserver.instance = new VaultObserver(app);
		}
		return VaultObserver.instance;
	}

	static cleanup(): void {
		if (VaultObserver.instance) {
			VaultObserver.instance.destroy();
			VaultObserver.instance = null;
		}
	}

	registerView(view: VaultUpdateHandler): void {
		this.views.add(view);
	}

	unregisterView(view: VaultUpdateHandler): void {
		this.views.delete(view);
	}

	private registerVaultEvents(): void {
		this.eventRefs.push(
			this.app.vault.on('create', (file) => {
				this.queueChange({
					type: 'create',
					file,
					affectedFolders: this.calculateAffectedFolders(file)
				});
			})
		);

		this.eventRefs.push(
			this.app.vault.on('delete', (file) => {
				this.queueChange({
					type: 'delete',
					file,
					affectedFolders: this.calculateAffectedFolders(file)
				});
			})
		);

		this.eventRefs.push(
			this.app.vault.on('rename', (file, oldPath) => {
				this.queueChange({
					type: 'rename',
					file,
					oldPath,
					affectedFolders: this.calculateAffectedFolders(file, oldPath)
				});
			})
		);

		this.eventRefs.push(
			this.app.vault.on('modify', (file) => {
				// Process all modify events, let views filter what's relevant
				this.queueChange({
					type: 'modify',
					file,
					affectedFolders: this.calculateAffectedFolders(file)
				});
			})
		);
	}

	private calculateAffectedFolders(file: TAbstractFile, oldPath?: string): string[] {
		const folders = new Set<string>();
		
		// Add file's parent folder
		if (file.parent) {
			folders.add(file.parent.path);
		}
		
		// For renames, add old parent folder
		if (oldPath) {
			const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
			if (oldParentPath && oldParentPath !== file.parent?.path) {
				folders.add(oldParentPath);
			}
		}
		
		// Add all ancestor folders (for count updates)
		let current = file.parent;
		while (current && !current.isRoot()) {
			folders.add(current.path);
			current = current.parent;
		}
		
		// Always include root folder for count updates
		folders.add('');
		
		return Array.from(folders);
	}

	private queueChange(change: VaultChange): void {
		this.pendingChanges.push(change);
		
		// Clear existing timer
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
		}
		
		// Set new timer to process changes
		this.debounceTimer = window.setTimeout(() => {
			this.processPendingChanges();
		}, this.DEBOUNCE_DELAY);
	}

	private processPendingChanges(): void {
		if (this.pendingChanges.length === 0) return;
		
		// Group changes by type and process them efficiently
		const changes = [...this.pendingChanges];
		this.pendingChanges = [];
		this.debounceTimer = null;
		
		// Process each change and notify registered views
		for (const change of changes) {
			this.notifyViews(change);
		}
	}

	private notifyViews(change: VaultChange): void {
		for (const view of this.views) {
			try {
				switch (change.type) {
					case 'create':
						view.handleFileCreate(change.file, change.affectedFolders);
						break;
					case 'delete':
						view.handleFileDelete(change.file, change.affectedFolders);
						break;
					case 'rename':
						if (change.oldPath) {
							view.handleFileRename(change.file, change.oldPath, change.affectedFolders);
						}
						break;
					case 'modify':
						view.handleFileModify(change.file, change.affectedFolders);
						break;
				}
			} catch (error) {
				console.error('Error notifying view of vault change:', error);
			}
		}
	}

	private destroy(): void {
		// Clear pending timer
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		
		// Unregister all vault events
		this.eventRefs.forEach(ref => this.app.vault.offref(ref));
		this.eventRefs = [];
		
		// Clear views
		this.views.clear();
		this.pendingChanges = [];
	}
}