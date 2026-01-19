import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type GhostyPostyPlugin from './main';
import { GhostAPI } from './ghost-api';
import { PostStatus } from './types';
import { FolderSuggest } from './folder-suggest';

export class GhostyPostySettingTab extends PluginSettingTab {
    plugin: GhostyPostyPlugin;

    constructor(app: App, plugin: GhostyPostyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Ghost URL setting
        new Setting(containerEl)
            .setName('Ghost admin URL')
            .setDesc('The URL of your ghost instance (e.g., https://myblog.com)')
            .addText(text => text
                .setPlaceholder('https://myblog.com')
                .setValue(this.plugin.settings.ghostUrl)
                .onChange(async (value) => {
                    this.plugin.settings.ghostUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        // API Key setting
        new Setting(containerEl)
            .setName('Admin API key')
            .setDesc('Your ghost admin API key (found in ghost admin → settings → integrations)')
            .addText(text => {
                text
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value.trim();
                        await this.plugin.saveSettings();
                    });
                // Make the input look like a password field
                text.inputEl.type = 'password';
                return text;
            });

        // Default status setting
        new Setting(containerEl)
            .setName('Default post status')
            .setDesc('The default status for new posts (can be overridden in frontmatter)')
            .addDropdown(dropdown => dropdown
                .addOption('draft', 'Draft')
                .addOption('published', 'Published')
                .setValue(this.plugin.settings.defaultStatus)
                .onChange(async (value) => {
                    this.plugin.settings.defaultStatus = value as PostStatus;
                    await this.plugin.saveSettings();
                }));

        // Archive folder setting
        new Setting(containerEl)
            .setName('Archive folder')
            .setDesc('Move notes to this folder after successful publishing (leave empty to disable)')
            .addText(text => {
                text
                    .setPlaceholder('Example: Published')
                    .setValue(this.plugin.settings.archiveFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.archiveFolder = value.trim();
                        await this.plugin.saveSettings();
                    });
                new FolderSuggest(this.app, text.inputEl);
                return text;
            });

        // Test connection button
        new Setting(containerEl)
            .setName('Test connection')
            .setDesc('Verify your ghost credentials are working')
            .addButton(button => button
                .setButtonText('Test connection')
                .onClick(async () => {
                    const { ghostUrl, apiKey } = this.plugin.settings;

                    if (!ghostUrl || !apiKey) {
                        new Notice('Please enter your ghost URL and API key first');
                        return;
                    }

                    button.setButtonText('Testing...');
                    button.setDisabled(true);

                    try {
                        const api = new GhostAPI(ghostUrl, apiKey);
                        const result = await api.testConnection();

                        if (result.success) {
                            new Notice(`Connected successfully to: ${result.siteName}`);
                        } else {
                            new Notice(`Connection failed: ${result.error}`);
                        }
                    } catch (error) {
                        new Notice(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    } finally {
                        button.setButtonText('Test connection');
                        button.setDisabled(false);
                    }
                }));

        // Help section
        new Setting(containerEl)
            .setName('How to get your API key')
            .setHeading();

        const helpList = containerEl.createEl('ol');
        helpList.createEl('li', { text: 'Go to your ghost admin panel' });
        helpList.createEl('li', { text: 'Navigate to settings → integrations' });
        helpList.createEl('li', { text: 'Click "add custom integration"' });
        helpList.createEl('li', { text: 'Give it a name (example: "publish to blog")' });
        helpList.createEl('li', { text: 'Copy the admin key' });
    }
}
