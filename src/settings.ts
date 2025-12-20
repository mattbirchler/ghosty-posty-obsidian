import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type GhostyPostyPlugin from './main';
import { GhostAPI } from './ghost-api';
import { PostStatus } from './types';

export class GhostyPostySettingTab extends PluginSettingTab {
    plugin: GhostyPostyPlugin;

    constructor(app: App, plugin: GhostyPostyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Ghosty Posty Settings' });

        // Ghost URL setting
        new Setting(containerEl)
            .setName('Ghost Admin URL')
            .setDesc('The URL of your Ghost instance (e.g., https://myblog.com)')
            .addText(text => text
                .setPlaceholder('https://myblog.com')
                .setValue(this.plugin.settings.ghostUrl)
                .onChange(async (value) => {
                    this.plugin.settings.ghostUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        // API Key setting
        new Setting(containerEl)
            .setName('Admin API Key')
            .setDesc('Your Ghost Admin API key (found in Ghost Admin → Settings → Integrations)')
            .addText(text => {
                text
                    .setPlaceholder('id:secret')
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

        // Test connection button
        new Setting(containerEl)
            .setName('Test connection')
            .setDesc('Verify your Ghost credentials are working')
            .addButton(button => button
                .setButtonText('Test Connection')
                .onClick(async () => {
                    const { ghostUrl, apiKey } = this.plugin.settings;

                    if (!ghostUrl || !apiKey) {
                        new Notice('Please enter your Ghost URL and API key first');
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
                        button.setButtonText('Test Connection');
                        button.setDisabled(false);
                    }
                }));

        // Help section
        containerEl.createEl('h3', { text: 'How to get your API key' });
        const helpList = containerEl.createEl('ol');
        helpList.createEl('li', { text: 'Go to your Ghost Admin panel' });
        helpList.createEl('li', { text: 'Navigate to Settings → Integrations' });
        helpList.createEl('li', { text: 'Click "Add custom integration"' });
        helpList.createEl('li', { text: 'Give it a name (e.g., "Obsidian Publisher")' });
        helpList.createEl('li', { text: 'Copy the "Admin API Key" (format: id:secret)' });
    }
}
