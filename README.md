# Video Composer

A web-based video composition tool for creating videos with timeline editing, drag-and-drop media support, and WebM export with alpha channel transparency.

## Features

- **Timeline Editor**: Drag and drop video clips and images on a timeline with snapping and scrolling
- **Visual Canvas**: Drag, scale, rotate, and adjust opacity of media elements in real-time
- **Multi-format Support**: Works with GIFs, MP4s, WebMs, WebPs, and various image formats
- **Audio Integration**: Add background music and sound tracks
- **WebM Export**: Export compositions as WebM videos with alpha channel support
- **Modern UI**: Clean, professional interface optimized for video editing workflows

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- Modern web browser with WebAssembly support

### Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser to `http://localhost:3000`

### Building for Production

```bash
npm run build
npm run serve
```

## Usage

### Adding Media

1. **Drag & Drop**: Drop video files, images, or audio files directly onto the interface
2. **Add Media Button**: Click "Add Media" to browse and select files
3. **Add Audio Button**: Click "Add Audio" to add background music

### Editing in Timeline

- **Drag clips**: Click and drag timeline items to reposition them in time
- **Zoom**: Hold Ctrl/Cmd and scroll to zoom in/out on the timeline
- **Scrub**: Click anywhere on the timeline to jump to that time
- **Adjust Duration**: Use +10s/-10s buttons to change composition length

### Canvas Manipulation

- **Select**: Click on media elements to select them
- **Move**: Drag selected elements to reposition
- **Scale**: Drag corner handles to resize
- **Rotate**: Drag rotation handle to rotate elements
- **Delete**: Press Delete key to remove selected elements

### Playback Controls

- **Play/Pause**: Click the play button or press Spacebar
- **Timeline Scrubbing**: Click on the timeline ruler to jump to specific times

### Export

1. Click "Export WebM" when your composition is ready
2. The export process will show progress and status
3. The final WebM file will automatically download when complete

## Technical Details

### Supported Formats

**Input:**
- Video: MP4, WebM, MOV, AVI
- Images: JPG, PNG, GIF, WebP, SVG
- Audio: MP3, WAV, OGG, M4A

**Output:**
- WebM with VP9 codec and alpha channel support

### Architecture

- **React**: Component-based UI framework
- **Fabric.js**: Canvas manipulation and transforms
- **FFmpeg.wasm**: Video encoding and export
- **Vite**: Build tool and development server

### Performance Considerations

- Videos are loaded and cached for smooth timeline scrubbing
- Canvas rendering is optimized with requestAnimationFrame
- Export process uses WebAssembly for efficient video encoding

## Keyboard Shortcuts

- `Space`: Play/Pause
- `Delete`: Remove selected item
- `Ctrl/Cmd + Scroll`: Zoom timeline

## Browser Compatibility

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

WebAssembly and modern JavaScript features are required.

## Development

### Project Structure

```
src/
├── components/           # React components
│   ├── VideoCanvas.jsx  # Canvas editing area
│   ├── Timeline.jsx     # Timeline editor
│   ├── Toolbar.jsx      # Top toolbar
│   └── ExportProgress.jsx # Export status
├── utils/
│   └── VideoComposer.js # Export logic
├── App.jsx              # Main application
└── main.jsx            # Entry point
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Troubleshooting

### Export Issues

- Ensure all media files are properly loaded before exporting
- Check browser console for detailed error messages
- Large compositions may take several minutes to export

### Performance Issues

- Reduce video resolution for better timeline performance
- Close other browser tabs to free up memory
- Use shorter video clips when possible

### Browser Compatibility

- Enable hardware acceleration in browser settings
- Update to the latest browser version
- Check WebAssembly support at webassembly.org 