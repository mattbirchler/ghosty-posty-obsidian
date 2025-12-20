# Ghosty Posty

Publish your Obsidian notes directly to Ghost blogs with automatic image uploads, frontmatter metadata support, and a beautiful confirmation modal.

## Features

### Content Publishing
- **One-Command Publishing**: Publish the current note to Ghost with a single command
- **Markdown to HTML Conversion**: Automatically converts your Obsidian markdown to Ghost-compatible HTML
- **Image Upload**: Automatically uploads local images to Ghost and updates references
- **Featured Images**: First-line images are automatically set as the post's featured image
- **Wiki Link Conversion**: Converts `[[links]]` to plain text for Ghost compatibility

### Publishing Options
- **Editable Metadata**: Review and edit title, tags, and status before publishing
- **Post Status**: Choose Draft, Published, or Scheduled
- **Scheduled Publishing**: Set a future date/time (in your local timezone) to publish
- **Featured Posts**: Toggle to mark posts as featured on your Ghost site
- **Tags Management**: Add comma-separated tags directly in the modal

### Frontmatter Support
Control your posts with YAML frontmatter:
- `title`: Override the filename as the post title
- `slug`: Custom URL slug for the post
- `tags`: Array or comma-separated list of tags
- `status`: `draft`, `published`, or `scheduled`
- `publish_date` or `date`: Schedule future publishing

### Cross-Platform
Works on Obsidian Desktop (Mac, Windows, Linux) and Mobile (iOS, Android).

## Installation

1. Download the latest release files:
   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Create a folder in your vault: `<vault>/.obsidian/plugins/ghosty-posty/`

3. Copy all three files into this folder

4. Restart Obsidian or reload plugins

5. Enable "Ghosty Posty" in Settings → Community Plugins

## Setup

### 1. Get Your Ghost Admin API Key

1. Log in to your Ghost Admin panel
2. Navigate to **Settings → Integrations**
3. Click **Add custom integration**
4. Give it a name (e.g., "Obsidian Publisher")
5. Copy the **Admin API Key** (format: `id:secret`)

### 2. Configure the Plugin

1. Open Obsidian Settings
2. Go to **Ghosty Posty** under Community Plugins
3. Enter your **Ghost Admin URL** (e.g., `https://yourblog.com`)
4. Paste your **Admin API Key**
5. Choose your **Default post status** (Draft recommended)
6. Click **Test Connection** to verify

## Usage

### Basic Publishing

1. Open the note you want to publish
2. Open the Command Palette (`Cmd/Ctrl + P`)
3. Run **"Publish to Ghost"**
4. Review the metadata in the modal:
   - Edit the title if needed
   - Choose the status (Draft/Published/Scheduled)
   - If Scheduled, pick a date and time
   - Add or modify tags
   - Toggle "Featured" if desired
5. Click **Publish**

### Using Frontmatter

Add YAML frontmatter to your notes for automatic metadata:

```yaml
---
title: "My Awesome Blog Post"
slug: "awesome-post"
tags: [blogging, tutorial, obsidian]
status: published
publish_date: 2024-12-25T09:00:00
---

Your content here...
```

### Image Handling

**Featured Images:**
- Place an image on the first line after frontmatter
- It will automatically become the featured image
- The image is removed from the post content

**Inline Images:**
- Both standard markdown `![alt](path)` and Obsidian embeds `![[image.png]]` are supported
- All local images are uploaded to Ghost automatically
- Image paths are updated to Ghost CDN URLs
- External URLs (http/https) are left unchanged

### Publishing Options

**Draft:** Save the post but don't make it visible to readers

**Published:** Make the post immediately visible on your blog

**Scheduled:** Choose a future date and time to automatically publish (uses your local timezone)

**Featured:** Mark the post as featured on your Ghost site

## Tips

- Use the **Test Connection** button in settings to verify your credentials work
- Start with drafts to preview your posts before publishing
- Tags from frontmatter will be pre-filled but can be edited in the modal
- Scheduled posts use your local timezone and are converted to UTC for Ghost
- The plugin will block publishing if any image fails to upload

## Troubleshooting

**"Connection failed"**
- Verify your Ghost URL is correct (no trailing slash)
- Check that your Admin API Key is in the format `id:secret`
- Ensure your Ghost site is accessible from your network

**"Image not found"**
- Check that image paths are relative to your vault or the current note
- Verify the image file exists in your vault

**"Failed to publish"**
- Check the error message for details
- Verify you have write permissions on your Ghost site
- Try the Test Connection button to diagnose authentication issues
