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
- **A button that says what it will do**: "Save draft", "Publish now", "Schedule for Thu 9:00 AM", "Publish and email 1,204 people", "Update live post"
- **Draft, publish or schedule**: one three-way choice, with a date picker (your local timezone) when scheduling
- **Excerpt**: set the summary shown on your home page, in email previews and on social cards
- **Tags as chips**: with autocomplete from the tags that already exist on your site
- **Visibility**: everyone, members only, or paid members only
- **Email**: send the post to a newsletter, with a confirmation step that shows who will receive it
- **More**: URL slug and featured post, tucked away until you need them

### Updating and Syncing
- **Updates start from Ghost**: reopening a published note loads the post from Ghost first, so its status, tags and other details start from what is live. A published post is never silently reverted to a draft.
- **Conflict warning**: if the post was edited on Ghost since you last published or synced, you are told before anything is sent and can sync first
- **Sync from Ghost**: pull the current version of a post back into the note
- **Edits are remembered**: the title, status, tags, visibility and excerpt you confirm are written back to the note's properties

### Images
- **Checked up front**: every image is listed with a thumbnail and size when the window opens. A missing file is flagged before you publish, and you can choose to publish without it.
- **Per-image progress**: each image shows its own state while uploading, three at a time
- **Upload memory**: images that are already on Ghost and unchanged are skipped on later updates
- **Retry**: if an upload fails, the ones that finished are kept and a retry only sends what failed
- **Featured image alt text**: alt text on the first-line image is sent to Ghost

### Videos
- **Local videos become Ghost video cards**: embed a video with `![[clip.mp4]]` or `![](clip.mp4)` and it is uploaded and shown with Ghost's own player
- **Thumbnail included**: a frame from the video is uploaded as its thumbnail, which Ghost shows before playback and in emails
- **Formats**: MP4, WebM and OGV, the formats Ghost accepts. Other formats (such as MOV) are flagged before you publish so you can convert them or leave them out.
- **Listed with your images**: videos appear in the same list, with the same progress, upload memory and retry
- Your Ghost site's own upload size limit applies. Audio and other file types are not uploaded.

### After Publishing
- **Useful confirmation**: a notice that says what happened, with links to open the post (or preview a draft), copy its link, or edit it in Ghost
- **Commands**: "Open post on Ghost", "Open in Ghost editor" and "Copy post link", also in the right-click menu
- **Status bar** (desktop): shows whether the open note is a draft, scheduled or published on Ghost, and whether it has edits that have not been pushed. Click it to update.

### Frontmatter Support
Control your posts with YAML frontmatter:
- `title`: Override the filename as the post title
- `slug`: Custom URL slug for the post
- `tags`: Array or comma-separated list of tags
- `status`: `draft`, `published`, or `scheduled` (for new posts; updates use the status on Ghost)
- `publish_date` or `date`: Schedule future publishing
- `visibility`: `public`, `members`, or `paid`
- `excerpt`: Custom excerpt
- `featured`: `true` or `false`

The plugin also writes `ghost_id`, `ghost_url` and `ghost_updated_at` to track the post.

### Obsidian Syntax
- Comments (`%%like this%%`) are removed and never published
- Image resize hints (`![[shot.png|400]]`) are not turned into alt text
- Embeds that are not images or videos (other notes, PDFs, audio) are left out, and the publish window tells you

### Archive After Publishing
- **Optional Archive Folder**: Automatically move notes to a designated folder once they are on Ghost
- **Your Choice of When**: Archive the first time a note is sent (drafts included), or only once it is published or scheduled
- **Folder Autocomplete**: Suggests existing folders as you type
- **Auto-Creates Folders**: Creates the archive folder if it doesn't exist
- **Collision Safe**: Appends a timestamp if a file with the same name is already in the archive

### Cross-Platform
Works on Obsidian Desktop (Mac, Windows, Linux) and Mobile (iOS, Android).

## Development

- `npm run dev` — build in watch mode
- `npm run build` — production build (`main.js`)
- `npm test` — run the unit tests

Tests use Node's built-in test runner (via [`tsx`](https://github.com/privatenumber/tsx)) and live alongside the code as `src/*.test.ts`. They cover the pure logic that's most likely to regress across builds — the Markdown-to-HTML conversion pipeline (frontmatter stripping, image extraction, featured-image detection, wiki links, embeds) and the frontmatter-key contract used for post updates and syncing.

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
6. *(Optional)* Set an **Archive folder** to automatically move notes after they're published — leave empty to disable
7. Click **Test Connection** to verify

## Usage

### Basic Publishing

1. Open the note you want to publish
2. Open the Command Palette (`Cmd/Ctrl + P`)
3. Run **"Publish to Ghost"**
4. Review the post in the window that opens:
   - Edit the title, excerpt and tags if needed
   - Choose Save draft, Publish now or Schedule
   - Choose who can read it, and whether to email it
   - Check the image list for anything missing
5. Press the button. Its label tells you exactly what will happen.

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

### Archiving Published Notes

If you set an **Archive folder** in settings, notes are automatically moved there after a successful publish:

- Leave the setting empty to keep notes in place after publishing
- The folder is created automatically if it doesn't exist
- If a file with the same name already exists in the archive, a timestamp is appended to avoid overwriting
- Internal links to the note are updated automatically when it's moved

## Tips

- Use the **Test Connection** button in settings to verify your credentials work
- Start with drafts to preview your posts before publishing
- Tags from frontmatter will be pre-filled but can be edited in the modal
- Scheduled posts use your local timezone and are converted to UTC for Ghost
- If an image is missing or fails to upload, you can fix it, retry, or publish without it

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
