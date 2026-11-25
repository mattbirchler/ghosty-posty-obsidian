import { AbstractInputSuggest, App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(app: App, private textInputEl: HTMLInputElement) {
        super(app, textInputEl);
    }

    getSuggestions(inputStr: string): TFolder[] {
        const lowerInput = inputStr.toLowerCase();
        const folders: TFolder[] = [];

        // Get all folders in the vault
        const allFiles = this.app.vault.getAllLoadedFiles();
        for (const file of allFiles) {
            if (file instanceof TFolder) {
                // Filter by input string (case-insensitive)
                if (file.path.toLowerCase().contains(lowerInput)) {
                    folders.push(file);
                }
            }
        }

        // Sort alphabetically by path
        folders.sort((a, b) => a.path.localeCompare(b.path));

        return folders;
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.textInputEl.value = folder.path;
        this.textInputEl.trigger('input');
        this.close();
    }
}
