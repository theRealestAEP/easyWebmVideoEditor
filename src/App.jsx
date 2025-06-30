import React, { useState, useRef, useCallback, useEffect } from 'react';
import VideoCanvas from './components/VideoCanvas';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import ExportProgress from './components/ExportProgress';
import { VideoComposer } from './utils/VideoComposer';

function App() {
  const [mediaItems, setMediaItems] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30); // Default 30 seconds
  const [exportProgress, setExportProgress] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sourceMedia, setSourceMedia] = useState([]);
  
  const fileInputRef = useRef();
  const videoComposer = useRef(new VideoComposer());

  // Calculate total duration based on media items
  const calculateDuration = useCallback(() => {
    if (mediaItems.length === 0) return 10; // Small default when no media
    const maxEndTime = Math.max(...mediaItems.map(item => item.startTime + item.duration));
    return Math.max(maxEndTime, 5); // Minimum 5 seconds, no arbitrary buffer
  }, [mediaItems]);

  // Update duration when media items change
  useEffect(() => {
    const newDuration = calculateDuration();
    if (Math.abs(newDuration - duration) > 0.1) {
      setDuration(newDuration);
    }
  }, [mediaItems, calculateDuration, duration]);

  // Handle adding media files
  const handleAddMedia = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle file input change
  const handleFileChange = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    await processFiles(files);
    e.target.value = ''; // Reset input
  }, []);

  // Process files and add to source media
  const processFiles = useCallback(async (files) => {
    console.log('Processing files:', files.length);
    
    const newSourceMedia = [];
    
    for (const file of files) {
      const fileType = file.type;
      let mediaType = 'unknown';
      let subtype = null;
      let duration = 0;
      
      // Determine media type
      if (fileType.startsWith('video/')) {
        mediaType = 'video';
        duration = await getVideoDuration(file);
      } else if (fileType.startsWith('image/')) {
        mediaType = 'image';
        if (fileType === 'image/gif') {
          subtype = 'gif';
          duration = await getGifDuration(file);
        }
      } else if (fileType.startsWith('audio/')) {
        mediaType = 'audio';
        duration = await getAudioDuration(file);
      }
      
      const sourceItem = {
        id: Date.now() + Math.random(),
        name: file.name,
        file: file,
        type: mediaType,
        subtype: subtype,
        duration: duration,
        url: URL.createObjectURL(file)
      };
      
      newSourceMedia.push(sourceItem);
      console.log('Added to source media:', sourceItem.name, sourceItem.type, sourceItem.duration);
    }
    
    setSourceMedia(prev => [...prev, ...newSourceMedia]);
  }, []);

  // Add drag and drop support to the main app
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processFiles(files);
    }
  }, [processFiles]);

  const handleSourceDragStart = useCallback((e, item) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(item));
    e.dataTransfer.setData('source-media', 'true'); // Mark as internal drag
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    // Only show drag overlay if it's not an internal source media drag
    const isInternalDrag = e.dataTransfer.types.includes('source-media');
    if (!isInternalDrag) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    // Only hide if leaving the app container and not dragging internal items
    if (e.target === e.currentTarget) {
      setIsDragOver(false);
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleTimelineUpdate = useCallback((items) => {
    setMediaItems(items);
  }, []);

  const handleItemUpdate = useCallback((item) => {
    setMediaItems(prev => 
      prev.map(i => i.id === item.id ? { ...i, ...item } : i)
    );
  }, []);

  const handleExport = useCallback(async () => {
    try {
      setExportProgress({ progress: 0, status: 'Initializing...' });
      
      // Try the main export with frame-by-frame approach
      const result = await videoComposer.current.exportVideo({
        mediaItems,
        duration,
        width: 1920, // Back to full resolution
        height: 1080, // Back to full resolution
        fps: 15, // Good balance of quality and performance
        onProgress: (progress, status) => {
          setExportProgress({ progress, status });
        }
      });

      // Create download link
      const link = document.createElement('a');
      link.href = result.url;
      link.download = 'composition.webm';
      link.click();
      
      setExportProgress(null);
    } catch (error) {
      console.error('Export failed:', error);
      
      // If main export fails due to memory issues, try fallback
      if (error.message.includes('memory') || error.message.includes('Memory')) {
        try {
          setExportProgress({ progress: 0, status: 'Trying MediaRecorder fallback...' });
          
          const result = await videoComposer.current.exportVideoFallback({
            mediaItems,
            duration,
            width: 1920, // Keep full resolution for fallback too
            height: 1080,
            fps: 15, // Same frame rate
            onProgress: (progress, status) => {
              setExportProgress({ progress, status: `Fallback: ${status}` });
            }
          });

          // Create download link
          const link = document.createElement('a');
          link.href = result.url;
          link.download = 'composition_fallback.webm';
          link.click();
          
          setExportProgress({ progress: 100, status: 'Export completed using MediaRecorder (no alpha channel)' });
          setTimeout(() => setExportProgress(null), 3000);
        } catch (fallbackError) {
          console.error('Fallback export also failed:', fallbackError);
          setExportProgress({ progress: 0, status: 'Export failed: Video too complex for browser memory. Try shorter clips or fewer items.' });
          setTimeout(() => setExportProgress(null), 5000);
        }
      } else {
        setExportProgress({ progress: 0, status: 'Export failed: ' + error.message });
        setTimeout(() => setExportProgress(null), 5000);
      }
    }
  }, [mediaItems, duration]);

  const handleClear = useCallback(() => {
    setMediaItems([]);
    setSourceMedia([]);
    setCurrentTime(0);
    setSelectedItem(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === 'Delete' && selectedItem) {
        setMediaItems(prev => prev.filter(item => item.id !== selectedItem.id));
        setSelectedItem(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, selectedItem]);

  // Debug logging
  useEffect(() => {
    console.log('Current media items:', mediaItems);
    console.log('Current time:', currentTime);
    console.log('Is playing:', isPlaying);
  }, [mediaItems, currentTime, isPlaying]);

  const getMediaTypeIcon = useCallback((item) => {
    switch (item.type) {
      case 'video':
        return '🎬';
      case 'image':
        return item.subtype === 'gif' ? '🎭' : '🖼️';
      case 'audio':
        return '🎵';
      default:
        return '��';
    }
  }, []);

  // Get video duration
  const getVideoDuration = useCallback((file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration || 5); // Default 5s if can't determine
      };
      video.onerror = () => {
        resolve(5); // Default fallback
      };
      video.src = URL.createObjectURL(file);
    });
  }, []);

  // Get GIF duration (approximate)
  const getGifDuration = useCallback((file) => {
    // For now, return a default duration - could be enhanced with GIF parsing
    return Promise.resolve(3); // Default 3 seconds for GIFs
  }, []);

  // Get audio duration
  const getAudioDuration = useCallback((file) => {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        window.URL.revokeObjectURL(audio.src);
        resolve(audio.duration || 30); // Default 30s if can't determine
      };
      audio.onerror = () => {
        resolve(30); // Default fallback
      };
      audio.src = URL.createObjectURL(file);
    });
  }, []);

  // Generate thumbnail for source media item
  const generateThumbnail = useCallback(async (item) => {
    return new Promise((resolve) => {
      if (item.type === 'video') {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.currentTime = 0.5; // Get frame at 0.5 seconds
        
        const onCanPlay = () => {
          // Small delay to ensure frame is loaded
          setTimeout(() => {
            try {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              canvas.width = 120;
              canvas.height = 68; // 16:9 aspect ratio
              
              ctx.fillStyle = '#222';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
              resolve(thumbnailUrl);
            } catch (error) {
              console.warn('Error generating video thumbnail:', error);
              resolve(null);
            }
            
            URL.revokeObjectURL(video.src);
          }, 100);
        };
        
        video.addEventListener('canplay', onCanPlay, { once: true });
        video.addEventListener('error', () => resolve(null), { once: true });
        video.src = item.url;
        video.load();
      } else if (item.type === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 120;
            canvas.height = 68;
            
            // Calculate aspect ratio to fit image
            const aspectRatio = img.width / img.height;
            let drawWidth = canvas.width;
            let drawHeight = canvas.height;
            let offsetX = 0;
            let offsetY = 0;
            
            if (aspectRatio > canvas.width / canvas.height) {
              drawHeight = canvas.width / aspectRatio;
              offsetY = (canvas.height - drawHeight) / 2;
            } else {
              drawWidth = canvas.height * aspectRatio;
              offsetX = (canvas.width - drawWidth) / 2;
            }
            
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
            
            const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(thumbnailUrl);
          } catch (error) {
            console.warn('Error generating image thumbnail:', error);
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = item.url;
      } else {
        resolve(null); // No thumbnail for audio
      }
    });
  }, []);

  // Generate thumbnails for source media when items are added
  useEffect(() => {
    const generateThumbnails = async () => {
      const updatedItems = await Promise.all(
        sourceMedia.map(async (item) => {
          if (!item.thumbnail && (item.type === 'video' || item.type === 'image')) {
            const thumbnail = await generateThumbnail(item);
            return { ...item, thumbnail };
          }
          return item;
        })
      );
      
      // Only update if thumbnails were added
      const hasNewThumbnails = updatedItems.some((item, index) => 
        item.thumbnail && !sourceMedia[index]?.thumbnail
      );
      
      if (hasNewThumbnails) {
        setSourceMedia(updatedItems);
      }
    };
    
    if (sourceMedia.length > 0) {
      generateThumbnails();
    }
  }, [sourceMedia, generateThumbnail]);

  return (
    <div className="app"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <Toolbar 
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onAddMedia={handleAddMedia}
        onExport={handleExport}
        onClear={handleClear}
        exportProgress={exportProgress}
      />
      
      <div className="main-content" style={{ 
        display: 'flex', 
        height: 'calc(100vh - 60px)',
        gap: '10px',
        padding: '10px'
      }}>
        {/* Source Media Panel */}
        <div className="source-media-panel" style={{
          width: '300px',
          background: '#2a2a2a',
          borderRadius: '8px',
          border: '1px solid #444',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #444',
            fontWeight: 'bold',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            📁 Source Media
            <span style={{ 
              marginLeft: 'auto', 
              fontSize: '12px', 
              color: '#999',
              fontWeight: 'normal'
            }}>
              {sourceMedia.length} items
            </span>
          </div>
          
          <div className="source-media-content" style={{
            flex: 1,
            overflow: 'auto',
            padding: '8px'
          }}>
            {sourceMedia.length === 0 ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '200px',
                color: '#666',
                textAlign: 'center',
                border: '2px dashed #444',
                borderRadius: '8px',
                margin: '8px'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
                <div style={{ marginBottom: '8px' }}>No media files</div>
                <div style={{ fontSize: '12px' }}>Use "Add Media" to upload files</div>
              </div>
            ) : (
              <div className="source-media-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: '8px',
                padding: '4px'
              }}>
                {sourceMedia.map(item => (
                  <div
                    key={item.id}
                    className="source-media-item"
                    draggable
                    onDragStart={(e) => handleSourceDragStart(e, item)}
                    style={{
                      background: '#333',
                      border: '1px solid #555',
                      borderRadius: '6px',
                      padding: '8px',
                      cursor: 'grab',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      minHeight: '80px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#404040';
                      e.currentTarget.style.borderColor = '#666';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#333';
                      e.currentTarget.style.borderColor = '#555';
                    }}
                  >
                    {item.thumbnail ? (
                      <img 
                        src={item.thumbnail} 
                        alt={item.name}
                        style={{
                          width: '100%',
                          height: '60px',
                          objectFit: 'cover',
                          borderRadius: '4px',
                          background: '#222'
                        }}
                      />
                    ) : (
                      <div style={{ 
                        fontSize: '24px',
                        width: '100%',
                        height: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#222',
                        borderRadius: '4px'
                      }}>
                        {getMediaTypeIcon(item)}
                      </div>
                    )}
                    <div style={{
                      fontSize: '11px',
                      color: '#ccc',
                      textAlign: 'center',
                      wordBreak: 'break-word',
                      lineHeight: '1.2'
                    }}>
                      {item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: '#999',
                      textAlign: 'center'
                    }}>
                      {item.duration ? `${item.duration.toFixed(1)}s` : 'Static'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Canvas and Timeline Area */}
        <div className="canvas-timeline-area" style={{ 
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <VideoCanvas
            mediaItems={mediaItems}
            currentTime={currentTime}
            isPlaying={isPlaying}
            selectedItem={selectedItem}
            onItemSelect={setSelectedItem}
            onItemUpdate={handleItemUpdate}
          />
          
          <Timeline
            mediaItems={mediaItems}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            onTimeUpdate={setCurrentTime}
            onItemsUpdate={handleTimelineUpdate}
            onDurationChange={setDuration}
          />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        multiple
        accept="video/*,image/*,audio/*,.gif,.webm,.webp"
        onChange={handleFileChange}
      />

      {/* Drag overlay */}
      {isDragOver && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          pointerEvents: 'none'
        }}>
          <div style={{
            background: '#333',
            border: '2px dashed #4a90e2',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            color: '#fff',
            fontSize: '18px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
            <div>Drop your media files here</div>
            <div style={{ fontSize: '14px', color: '#ccc', marginTop: '8px' }}>
              Supports: MP4, WebM, GIF, WebP, PNG, JPG, MP3, WAV
            </div>
          </div>
        </div>
      )}

      {exportProgress && (
        <ExportProgress progress={exportProgress} />
      )}
    </div>
  );
}

export default App; 