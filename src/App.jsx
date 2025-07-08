import React, { useState, useRef, useCallback, useEffect } from 'react';
import VideoCanvas from './components/VideoCanvas';
import Timeline from './components/Timeline';
import VolumeBar from './components/VolumeBar';
import Toolbar from './components/Toolbar';
import ExportProgress from './components/ExportProgress';
import { VideoComposer } from './utils/VideoComposer';
import TenorSearch from './components/TenorSearch';
import ProjectManager from './utils/ProjectManager';

function App() {
  const [mediaItems, setMediaItems] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30); // Default 30 seconds
  const [exportProgress, setExportProgress] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sourceMedia, setSourceMedia] = useState([]);
  const [isExporting, setIsExporting] = useState(false); // Track export state for UI cleanup
  const [timelineAudioElements, setTimelineAudioElements] = useState(new Map()); // Track timeline audio elements for VolumeBar
  
  // Settings state
  const [settings, setSettings] = useState({
    canvasWidth: 1920,
    canvasHeight: 1080,
    exportFrameRate: 15
  });
  
  // Project management state
  const [currentProjectName, setCurrentProjectName] = useState(null);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [projectAction, setProjectAction] = useState(null); // 'save' or 'load'
  const [notification, setNotification] = useState(null);
  
  const fileInputRef = useRef();
  const timelineRef = useRef();
  const videoComposer = useRef(new VideoComposer());
  const projectManager = useRef(new ProjectManager());
  const lastStateRef = useRef(null);

  // Store File objects separately to preserve them during drag/drop
  const sourceFileMap = useRef(new Map());

  // Calculate total duration based on media items
  const calculateDuration = useCallback(() => {
    if (mediaItems.length === 0) return 10; // Default when no media
    const maxEndTime = Math.max(...mediaItems.map(item => item.startTime + item.duration));
    return maxEndTime + 0.1; // Just a tiny buffer to prevent edge cases, no artificial minimum
  }, [mediaItems]);

  // Update duration when media items change
  useEffect(() => {
    const newDuration = calculateDuration();
    if (Math.abs(newDuration - duration) > 0.1) {
      setDuration(newDuration);
    }
  }, [mediaItems, calculateDuration, duration]);

  // Update timeline audio elements for VolumeBar
  useEffect(() => {
    const updateAudioElements = () => {
      if (timelineRef.current?.getAudioElements) {
        const audioElements = timelineRef.current.getAudioElements();
        setTimelineAudioElements(audioElements);
        // console.log('📊 Updated VolumeBar audio elements:', audioElements.size, 'elements');
      }
    };

    // Update immediately if timeline is ready
    updateAudioElements();

    // Also update periodically to catch new audio elements
    const interval = setInterval(updateAudioElements, 500);

    return () => clearInterval(interval);
  }, [mediaItems, isPlaying]); // Re-run when media items or playback state changes

  // Get current app state for project management
  const getCurrentState = useCallback(() => {
    // Create a clean version of sourceMedia without File objects for saving
    const cleanSourceMedia = sourceMedia.map(item => {
      const { file, ...cleanItem } = item;
      return {
        ...cleanItem,
        hasFile: !!file // Keep track of whether this item had a file
      };
    });

    return {
      mediaItems,
      sourceMedia: cleanSourceMedia,
      currentTime,
      duration,
      settings,
      selectedItem
    };
  }, [mediaItems, sourceMedia, currentTime, duration, settings, selectedItem]);

  // Push state to undo stack when significant changes occur
  const pushUndoState = useCallback(() => {
    const currentState = getCurrentState();
    
    // Only push if state has actually changed
    const stateString = JSON.stringify({
      mediaItems: currentState.mediaItems.map(item => ({ ...item, file: null })),
      sourceMedia: currentState.sourceMedia.map(item => ({ ...item, file: null, thumbnail: null }))
    });
    
    if (lastStateRef.current !== stateString) {
      projectManager.current.pushState(currentState);
      lastStateRef.current = stateString;
    }
  }, [getCurrentState]);

  // Show notification
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Initialize project manager and push initial state
  useEffect(() => {
    projectManager.current.init().then(() => {
      pushUndoState(); // Push initial state
    });
  }, [pushUndoState]);

  // Push state when significant changes occur
  useEffect(() => {
    pushUndoState();
  }, [mediaItems, sourceMedia, pushUndoState]);

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
    // console.log('Processing files:', files.length);
    
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
        } else {
          duration = 5; // Default for static images
        }
      } else if (fileType.startsWith('audio/')) {
        mediaType = 'audio';
        duration = await getAudioDuration(file);
      }
      
      const itemId = Date.now() + Math.random();
      
      const sourceItem = {
        id: itemId,
        name: file.name,
        type: mediaType,
        subtype: subtype,
        duration: duration,
        url: URL.createObjectURL(file),
        hasFile: true,
        file: file // Keep File object for direct access
      };
      
      // Store the File object in the map for drag-and-drop restoration
      sourceFileMap.current.set(itemId, file);
      
      newSourceMedia.push(sourceItem);
      // console.log('Added to source media:', sourceItem.name, sourceItem.type, sourceItem.duration);
      
      // For MP4 video files, automatically check for and create a separate audio track
      if (mediaType === 'video' && fileType === 'video/mp4') {
        try {
          // console.log('🎬 Checking MP4 for audio track:', file.name);
          
          // Use a more reliable audio detection method
          const hasAudio = await new Promise((resolve) => {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.muted = true;
            video.preload = 'metadata';
            video.src = URL.createObjectURL(file);
            
            let resolved = false;
            
            const cleanup = () => {
              if (!resolved) {
                resolved = true;
                URL.revokeObjectURL(video.src);
              }
            };
            
            video.onloadedmetadata = () => {
              if (resolved) return;
              
              // Multiple detection methods
              const audioTrackCount = video.audioTracks?.length || 0;
              const webkitAudio = video.webkitAudioDecodedByteCount || 0;
              const mozAudio = video.mozHasAudio || false;
              
              // More reliable: try to actually load some audio data
              let audioDetected = false;
              
              // Method 1: Check if video duration suggests audio
              const hasDuration = video.duration && video.duration > 0;
              
              // Method 2: Browser-specific audio properties
              const browserAudioDetected = audioTrackCount > 0 || webkitAudio > 0 || mozAudio;
              
              // Method 3: For MP4s, assume audio exists unless proven otherwise
              // This is safer since most MP4s have audio and false positives are better than false negatives
              audioDetected = hasDuration || browserAudioDetected;
              
              // console.log('🔍 MP4 audio detection results:', {
              //   name: file.name,
              //   duration: video.duration,
              //   audioTracks: audioTrackCount,
              //   webkitAudioDecodedByteCount: webkitAudio,
              //   mozHasAudio: mozAudio,
              //   hasDuration: hasDuration,
              //   browserAudioDetected: browserAudioDetected,
              //   finalDecision: audioDetected
              // });
              
              cleanup();
              resolve(audioDetected);
            };
            
            video.onerror = (error) => {
              // console.warn('⚠️ Video loading failed for audio detection:', file.name, error);
              cleanup();
              // If we can't load the video, assume it has audio to be safe
              resolve(true);
            };
            
            // Timeout - assume audio exists if we can't determine
            setTimeout(() => {
              console.warn('⏰ Audio detection timeout for:', file.name, '- assuming audio exists');
              cleanup();
              resolve(true);
            }, 8000);
          });
          
          // Always create audio track for MP4s for now (user can delete if not needed)
          // This is safer than missing audio tracks
          const shouldCreateAudioTrack = true; // Override detection for reliability
          
          if (shouldCreateAudioTrack) {
            // console.log('✅ Creating audio track for MP4:', file.name, '(Audio detected:', hasAudio, ')');
            
            // Create a separate audio source media item
            const audioItemId = Date.now() + Math.random() + 0.1; // Slightly different ID
            const audioSourceItem = {
              id: audioItemId,
              name: `${file.name.replace(/\.[^/.]+$/, '')} (Audio)`, // Remove extension and add (Audio)
              type: 'audio',
              subtype: 'mp4_audio',
              duration: duration, // Same duration as video
              url: URL.createObjectURL(file), // Same file, but will be used for audio extraction
              hasFile: true,
              file: file, // Same File object
              isVideoAudio: true, // Flag to indicate this is audio extracted from video
              sourceVideoId: itemId // Reference to the original video item
            };
            
            // Store the same File object for the audio item
            sourceFileMap.current.set(audioItemId, file);
            
            // FIXED: Mark the video item as having a separate audio track
            sourceItem.hasAudioTrack = true;
            sourceItem.audioTrackId = audioItemId;
            
            newSourceMedia.push(audioSourceItem);
            // console.log('✅ Added audio track from MP4:', audioSourceItem.name);
          } else {
            // console.log('ℹ️ Skipping audio track creation for MP4:', file.name);
          }
          
        } catch (audioDetectionError) {
          console.warn('❌ Error during MP4 audio detection:', file.name, audioDetectionError);
          
          // Fallback: create audio track anyway since detection failed
          // console.log('🔄 Creating audio track as fallback for:', file.name);
          
          const audioItemId = Date.now() + Math.random() + 0.2;
          const audioSourceItem = {
            id: audioItemId,
            name: `${file.name.replace(/\.[^/.]+$/, '')} (Audio)`,
            type: 'audio',
            subtype: 'mp4_audio',
            duration: duration,
            url: URL.createObjectURL(file),
            hasFile: true,
            file: file,
            isVideoAudio: true,
            sourceVideoId: itemId
          };
          
          sourceFileMap.current.set(audioItemId, file);
          
          // FIXED: Mark the video item as having a separate audio track (fallback case)
          sourceItem.hasAudioTrack = true;
          sourceItem.audioTrackId = audioItemId;
          
          newSourceMedia.push(audioSourceItem);
          // console.log('✅ Added fallback audio track from MP4:', audioSourceItem.name);
        }
      }
    }
    
    setSourceMedia(prev => [...prev, ...newSourceMedia]);
  }, []);

  // Process individual media file into PNG sequence
  const processMediaFile = useCallback(async (sourceItem, file) => {
    try {
      // console.log('Starting frame extraction for:', sourceItem.name, 'Has file object:', !!sourceItem.file);
      
      // Extract frames using MediaProcessor with the sourceItem that includes the File object
      const frameData = await videoComposer.current.extractFrames(sourceItem);
      
      // console.log('Frame extraction completed for:', sourceItem.name);
      
      // Update source media item with frame data
      setSourceMedia(prev => prev.map(item => 
        item.id === sourceItem.id 
          ? { ...item, frameData, isProcessing: false }
          : item
      ));
      
    } catch (error) {
      console.error('Processing failed for:', sourceItem.name, error);
      
      // Update source media to mark processing as failed
      setSourceMedia(prev => prev.map(item => 
        item.id === sourceItem.id 
          ? { ...item, isProcessing: false, processingError: error.message }
          : item
      ));
      
    }
  }, []);

  // Add drag and drop support to the main app
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    // Check if this is an internal drag from source media - if so, ignore it
    const isInternalDrag = e.dataTransfer.types.includes('source-media');
    if (isInternalDrag) {
      // console.log('Ignoring internal source media drag');
      return;
    }
    
    // Check for files first
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processFiles(files);
      return;
    }
    
    // Check for custom data (like from Tenor picker)
    try {
      let tenorData = null;
      
      // Try application/json first
      try {
        tenorData = e.dataTransfer.getData('application/json');
        if (tenorData) {
          // console.log('Found JSON data:', tenorData);
        }
      } catch (err) {}
      
      // Try text/plain
      if (!tenorData) {
        try {
          tenorData = e.dataTransfer.getData('text/plain');
          if (tenorData && (tenorData.includes('tenor') || tenorData.includes('gif'))) {
            // console.log('Found text data:', tenorData);
          } else {
            tenorData = null; // Clear if not relevant
          }
        } catch (err) {}
      }
      
      // Try text/uri-list (for URLs)
      if (!tenorData) {
        try {
          const uriData = e.dataTransfer.getData('text/uri-list');
          if (uriData && (uriData.includes('tenor') || uriData.includes('.gif'))) {
            // console.log('Found URI data:', uriData);
            
            // Extract name from Tenor URL if possible
            let stickerName = 'Tenor Sticker';
            try {
              if (uriData.includes('tenor.com')) {
                const url = new URL(uriData);
                const pathParts = url.pathname.split('/');
                
                if (pathParts.length >= 3) {
                  const filename = pathParts[pathParts.length - 1];
                  const nameWithoutExt = filename.split('.')[0];
                  
                  if (nameWithoutExt && nameWithoutExt !== 'undefined' && nameWithoutExt.length > 1) {
                    stickerName = nameWithoutExt
                      .split('-')
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                      .join(' ');
                  }
                }
              }
            } catch (error) {
              console.warn('Failed to extract name from URI:', uriData, error);
            }
            
            // Create a media item from the URL
            const mediaItem = {
              id: `tenor_${Date.now()}`,
              name: stickerName,
              type: 'image',
              subtype: uriData.includes('.gif') ? 'gif' : 'sticker', // Detect if it's a GIF URL
              url: uriData,
              width: 200,
              height: 200,
              duration: 3,
              source: 'tenor',
              hasTransparency: true // Assume Tenor stickers have transparency
            };
            
            setSourceMedia(prev => [...prev, mediaItem]);
            // console.log('Added Tenor item from URI to source media:', mediaItem);
            return;
          }
        } catch (err) {}
      }
      
      if (tenorData) {
        try {
          const parsedData = JSON.parse(tenorData);
          // console.log('Parsed Tenor data:', parsedData);
          
          // Convert to our media format if it's a tenor item
          if (parsedData.url || parsedData.tenorUrl) {
            const mediaItem = {
              id: `tenor_${parsedData.id || Date.now()}`,
              name: parsedData.description || parsedData.name || `Tenor ${parsedData.id?.slice(-6) || 'Sticker'}`,
              type: 'image',
              subtype: parsedData.format && parsedData.format.includes('gif') ? 'gif' : 'sticker',
              url: parsedData.url,
              width: parsedData.width || 200,
              height: parsedData.height || 200,
              duration: 3,
              source: 'tenor',
              tenorUrl: parsedData.tenorUrl,
              tags: parsedData.tags || [],
              hasTransparency: parsedData.hasTransparency,
              format: parsedData.format
            };
            
            setSourceMedia(prev => [...prev, mediaItem]);
            // console.log('Added Tenor item to source media:', mediaItem);
            return;
          }
        } catch (parseErr) {
          console.log('Could not parse data as JSON:', parseErr);
        }
      }
      
      // console.log('No recognizable Tenor data found in drop');
      
    } catch (error) {
      console.log('Error handling drop data:', error);
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
    // Don't allow playback changes during export
    if (exportProgress) return;
    
    setIsPlaying(prev => !prev);
  }, [exportProgress]);

  const handleTimelineUpdate = useCallback((items) => {
    setMediaItems(items);
  }, []);

  // Function to restore File objects for timeline items created from source media
  const restoreFileForItem = useCallback((item) => {
    if (item.hasFile) {
      // Use sourceId if available (for timeline items), otherwise use the item's own id (for source items)
      const sourceId = item.sourceId || item.id;
      const restoredItem = { ...item };
      
      // Restore File object
      if (sourceFileMap.current.has(sourceId)) {
        restoredItem.file = sourceFileMap.current.get(sourceId);
      }
      
      return restoredItem;
    }
    return item;
  }, []);

  const handleItemUpdate = useCallback((item) => {
    setMediaItems(prev => 
      prev.map(i => i.id === item.id ? { ...i, ...item } : i)
    );
  }, []);

  const handleExport = useCallback(async () => {
    try {
      // Stop playback and enable export mode
      setIsPlaying(false);
      setIsExporting(true);
      setSelectedItem(null); // Clear selection to remove any active handles
      // console.log('Export mode enabled, waiting for canvas update...');
      setExportProgress({ progress: 0, status: 'Initializing...' });
      
      // Create timeline seek callback for canvas capture
      const onTimelineSeek = async (time) => {
        setCurrentTime(time);
        // Return a promise that resolves when the canvas has updated
        return new Promise(resolve => {
          // Single requestAnimationFrame should be sufficient
          requestAnimationFrame(() => {
            resolve();
          });
        });
      };
      
      // Give canvas time to update with export mode before starting capture
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try the main export with canvas capture approach
      const result = await videoComposer.current.exportVideo({
        mediaItems,
        duration,
        width: settings.canvasWidth, // Use settings canvas width
        height: settings.canvasHeight, // Use settings canvas height
        fps: settings.exportFrameRate, // Use custom frame rate
        onProgress: (progress, status) => {
          setExportProgress({ progress, status });
        },
        onTimelineSeek
      });

      // Create download link
      const link = document.createElement('a');
      link.href = result.url;
      link.download = 'composition.webm';
      link.click();
      
      setExportProgress(null);
      setIsExporting(false); // Turn off export mode
    } catch (error) {
      console.error('Export failed:', error);
      
      // If main export fails due to memory issues, try fallback
      if (error.message.includes('memory') || error.message.includes('Memory')) {
        try {
          setExportProgress({ progress: 0, status: 'Trying MediaRecorder fallback...' });
          
          // Create timeline seek callback for fallback too
          const onTimelineSeek = async (time) => {
            setCurrentTime(time);
            return new Promise(resolve => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          };
          
          // Give canvas time to update with export mode before starting fallback capture
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const result = await videoComposer.current.exportVideoFallback({
            mediaItems,
            duration,
            width: settings.canvasWidth, // Use settings canvas width
            height: settings.canvasHeight, // Use settings canvas height
            fps: settings.exportFrameRate, // Use custom frame rate
            onProgress: (progress, status) => {
              setExportProgress({ progress, status: `Fallback: ${status}` });
            },
            onTimelineSeek
          });

          // Create download link
          const link = document.createElement('a');
          link.href = result.url;
          link.download = 'composition_fallback.webm';
          link.click();
          
          setExportProgress({ progress: 100, status: 'Export completed using MediaRecorder (no alpha channel)' });
          setTimeout(() => {
            setExportProgress(null);
            setIsExporting(false);
          }, 3000);
        } catch (fallbackError) {
          console.error('Fallback export also failed:', fallbackError);
          setExportProgress({ progress: 0, status: 'Export failed: Video too complex for browser memory. Try shorter clips or fewer items.' });
          setTimeout(() => {
            setExportProgress(null);
            setIsExporting(false);
          }, 5000);
        }
      } else {
        setExportProgress({ progress: 0, status: 'Export failed: ' + error.message });
        setTimeout(() => {
          setExportProgress(null);
          setIsExporting(false);
        }, 5000);
      }
    }
  }, [mediaItems, duration, settings]);

  const handleClear = useCallback(() => {
    // Clean up blob URLs before clearing
    sourceMedia.forEach(item => {
      if (item.url && item.url.startsWith('blob:')) {
        URL.revokeObjectURL(item.url);
      }
    });
    
    // Clear the source file map
    sourceFileMap.current.clear();
    
    setMediaItems([]);
    setSourceMedia([]);
    setCurrentTime(0);
    setSelectedItem(null);
    setCurrentProjectName(null);
    
    // Push state for undo
    setTimeout(pushUndoState, 100);
  }, [sourceMedia, pushUndoState]);

  // Handle Tenor GIF selection
  const handleTenorGifSelect = useCallback((gifMediaItem) => {
    // console.log('Adding Tenor GIF to source media:', gifMediaItem);
    
    // Only add the selected GIF to source media - let user drag to timeline
    setSourceMedia(prev => [...prev, gifMediaItem]);
  }, []);

  // Undo functionality
  const handleUndo = useCallback(async () => {
    if (!projectManager.current.canUndo()) return;
    
    const previousState = projectManager.current.undo(getCurrentState());
    if (previousState) {
      // Restore File objects for source media items from our file map
      const restoredSourceMedia = previousState.sourceMedia.map(item => {
        if (item.hasFile && sourceFileMap.current.has(item.id)) {
          return {
            ...item,
            file: sourceFileMap.current.get(item.id)
          };
        }
        return item;
      });
      
      setMediaItems(previousState.mediaItems);
      setSourceMedia(restoredSourceMedia);
      setCurrentTime(previousState.currentTime);
      setDuration(previousState.duration);
      setSettings(previousState.settings);
      setSelectedItem(previousState.selectedItem);
      
      showNotification('Undo successful');
    }
  }, [getCurrentState, showNotification]);

  // Redo functionality  
  const handleRedo = useCallback(async () => {
    if (!projectManager.current.canRedo()) return;
    
    const nextState = projectManager.current.redo();
    if (nextState) {
      // Restore File objects for source media items from our file map
      const restoredSourceMedia = nextState.sourceMedia.map(item => {
        if (item.hasFile && sourceFileMap.current.has(item.id)) {
          return {
            ...item,
            file: sourceFileMap.current.get(item.id)
          };
        }
        return item;
      });
      
      setMediaItems(nextState.mediaItems);
      setSourceMedia(restoredSourceMedia);
      setCurrentTime(nextState.currentTime);
      setDuration(nextState.duration);
      setSettings(nextState.settings);
      setSelectedItem(nextState.selectedItem);
      
      showNotification('Redo successful');
    }
  }, [showNotification]);

  // Save project
  const handleSaveProject = useCallback(async (projectName) => {
    const currentState = getCurrentState();
    const result = await projectManager.current.saveProject(currentState, projectName);
    
    if (result.success) {
      setCurrentProjectName(result.projectName);
      showNotification(`Project "${result.projectName}" saved successfully!`, 'success');
    } else {
      showNotification(`Failed to save project: ${result.error}`, 'error');
    }
    
    setShowProjectDialog(false);
  }, [getCurrentState, showNotification]);

  // Load project
  const handleLoadProject = useCallback(async (projectId) => {
    const result = await projectManager.current.loadProject(projectId);
    
    if (result.success) {
      const project = result.project;
      
      // Check for source media items that need File objects restored
      const sourceMediaWithFiles = project.sourceMedia?.map(item => {
        if (item.hasFile && sourceFileMap.current.has(item.id)) {
          // File object still available in memory
          return {
            ...item,
            file: sourceFileMap.current.get(item.id)
          };
        } else if (item.hasFile) {
          // File object not available - mark as needing re-import
          return {
            ...item,
            needsReimport: true,
            processingError: 'File needs to be re-imported'
          };
        }
        return item;
      }) || [];
      
      setMediaItems(project.mediaItems || []);
      setSourceMedia(sourceMediaWithFiles);
      setCurrentTime(project.currentTime || 0);
      setDuration(project.duration || 30);
      setSettings(project.settings || settings);
      setSelectedItem(project.selectedItem || null);
      setCurrentProjectName(project.name);
      
      // Clear undo history when loading a project
      projectManager.current.clearHistory();
      pushUndoState();
      
      showNotification(`Project "${project.name}" loaded successfully!`, 'success');
      
      // Check for files that need to be re-imported
      const missingFiles = sourceMediaWithFiles.filter(item => item.needsReimport || item.processingError);
      if (missingFiles.length > 0) {
        showNotification(`${missingFiles.length} uploaded file${missingFiles.length > 1 ? 's' : ''} need${missingFiles.length > 1 ? '' : 's'} to be re-imported. Use "Add Media" to upload them again.`, 'warning');
      }
    } else {
      showNotification(`Failed to load project: ${result.error}`, 'error');
    }
    
    setShowProjectDialog(false);
  }, [settings, pushUndoState, showNotification]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle keyboard shortcuts if user is typing in an input field
      const isTyping = document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable
      );

      if (e.key === ' ' && !isTyping && !exportProgress) {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === 'Delete' && selectedItem && !isTyping && !exportProgress) {
        setMediaItems(prev => prev.filter(item => item.id !== selectedItem.id));
        setSelectedItem(null);
      } else if ((e.ctrlKey || e.metaKey) && !isTyping && !exportProgress) {
        // Undo/Redo shortcuts
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        } else if (e.key === 's') {
          e.preventDefault();
          setProjectAction('save');
          setShowProjectDialog(true);
        } else if (e.key === 'o') {
          e.preventDefault();
          setProjectAction('load');
          setShowProjectDialog(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, selectedItem, exportProgress, handleUndo, handleRedo]);

  // Debug logging
  // useEffect(() => {
    // console.log('Current media items:', mediaItems);
    // console.log('Current time:', currentTime);
    // console.log('Is playing:', isPlaying);
  // }, [mediaItems, currentTime, isPlaying]);

  const getMediaTypeIcon = useCallback((item) => {
    switch (item.type) {
      case 'video':
        return '🎬';
      case 'image':
        return (item.subtype === 'gif' || item.subtype === 'sticker') ? '🎭' : '🖼️';
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
      } else if (item.type === 'audio') {
        // Generate audio waveform thumbnail
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 120;
          canvas.height = 68;
          
          // Dark background
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Audio icon and text for MP4 audio tracks
          if (item.subtype === 'mp4_audio' || item.isVideoAudio) {
            // Special styling for MP4 audio tracks
            ctx.fillStyle = '#06b6d4'; // Cyan color for video audio
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🎬🎵', canvas.width / 2, 25);
            ctx.fillText('MP4 Audio', canvas.width / 2, 45);
            ctx.fillText('Track', canvas.width / 2, 58);
          } else {
            // Regular audio file styling
            ctx.fillStyle = '#10b981'; // Green color for regular audio
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🎵', canvas.width / 2, 30);
            ctx.fillText('Audio', canvas.width / 2, 50);
          }
          
          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(thumbnailUrl);
        } catch (error) {
          console.warn('Error generating audio thumbnail:', error);
          resolve(null);
        }
      } else {
        resolve(null); // No thumbnail for unknown type
      }
    });
  }, []);

  // Generate thumbnails for source media when items are added
  useEffect(() => {
    const generateThumbnails = async () => {
      const updatedItems = await Promise.all(
        sourceMedia.map(async (item) => {
          if (!item.thumbnail && (item.type === 'video' || item.type === 'image' || item.type === 'audio')) {
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

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      // Clean up all blob URLs when component unmounts
      sourceMedia.forEach(item => {
        if (item.url && item.url.startsWith('blob:')) {
          URL.revokeObjectURL(item.url);
        }
      });
      sourceFileMap.current.clear();
    };
  }, []); // Empty dependency array means this only runs on unmount

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
        settings={settings}
        onSettingsChange={setSettings}
        // Project management props
        onSaveProject={() => {
          setProjectAction('save');
          setShowProjectDialog(true);
        }}
        onLoadProject={() => {
          setProjectAction('load');
          setShowProjectDialog(true);
        }}
        // Undo/redo props
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={projectManager.current?.canUndo()}
        canRedo={projectManager.current?.canRedo()}
        currentProjectName={currentProjectName}
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
          flexDirection: 'column',
          height: '100%',
          contain: 'layout style paint', // CSS containment for isolation
          isolation: 'isolate' // Create isolated stacking context
        }}>
          {/* Top Half - Existing Media Files */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
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
                  height: '120px',
                color: '#666',
                textAlign: 'center',
                border: '2px dashed #444',
                borderRadius: '8px',
                margin: '8px'
              }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
                  <div style={{ marginBottom: '4px', fontSize: '12px' }}>No media files</div>
                  <div style={{ fontSize: '10px' }}>Use "Add Media" to upload files</div>
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
                    draggable={true}
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
                      transition: 'all 0.2s ease',
                      position: 'relative'
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

          {/* Divider */}
          <div style={{
            height: '1px',
            background: '#444',
            margin: '0'
          }} />

          {/* Bottom Half - Tenor Search */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0
          }}>
            <TenorSearch onStickerSelect={handleTenorGifSelect} />
          </div>
        </div>

        {/* Canvas and Timeline Area */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '10px', 
          flex: 1,
          minHeight: 0 
        }}>
          <VideoCanvas
            mediaItems={mediaItems}
            currentTime={currentTime}
            isPlaying={isPlaying}
            selectedItem={selectedItem}
            onItemSelect={setSelectedItem}
            onItemUpdate={handleItemUpdate}
            canvasWidth={settings.canvasWidth}
            canvasHeight={settings.canvasHeight}
            exportMode={isExporting}
            onItemsUpdate={handleTimelineUpdate}
            restoreFileForItem={restoreFileForItem}
          />
          
          {/* Timeline and Volume Bar Container */}
          <div style={{ display: 'flex', gap: '0', height: '300px' }}>
            <div style={{ flex: 1 }}>
              <Timeline
                ref={timelineRef}
                mediaItems={mediaItems}
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                onTimeUpdate={setCurrentTime}
                onPlayPause={handlePlayPause}
                onItemsUpdate={handleTimelineUpdate}
                onDurationChange={setDuration}
                playbackFrameRate={settings.exportFrameRate}
                restoreFileForItem={restoreFileForItem}
                exportMode={isExporting}
              />
            </div>
            
            <VolumeBar 
              audioElements={timelineAudioElements} 
              isPlaying={isPlaying} 
            />
          </div>
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
        <ExportProgress progress={exportProgress.progress} status={exportProgress.status} />
      )}

      {/* Project Save/Load Dialog */}
      {showProjectDialog && (
        <ProjectDialog
          action={projectAction}
          currentProjectName={currentProjectName}
          onSave={handleSaveProject}
          onLoad={handleLoadProject}
          onCancel={() => setShowProjectDialog(false)}
          projectManager={projectManager.current}
        />
      )}

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          borderRadius: '6px',
          color: '#fff',
          fontWeight: '500',
          fontSize: '14px',
          zIndex: 2000,
          background: notification.type === 'success' ? '#10b981' : 
                     notification.type === 'error' ? '#ef4444' : 
                     notification.type === 'warning' ? '#f59e0b' : '#6b7280',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          transform: 'translateX(0)',
          animation: 'slideIn 0.3s ease-out'
        }}>
          {notification.message}
        </div>
      )}
    </div>
  );
}

// Project Dialog Component
const ProjectDialog = ({ action, currentProjectName, onSave, onLoad, onCancel, projectManager }) => {
  const [projectName, setProjectName] = useState(currentProjectName || '');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (action === 'load') {
      setLoading(true);
      projectManager.getProjectList().then(projectList => {
        setProjects(projectList);
        setLoading(false);
      });
    }
  }, [action, projectManager]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (action === 'save' && projectName.trim()) {
      onSave(projectName.trim());
    }
  };

  const handleLoadProject = (projectId) => {
    onLoad(projectId);
  };

  const handleDeleteProject = async (projectId, projectName) => {
    if (confirm(`Are you sure you want to delete "${projectName}"?`)) {
      const result = await projectManager.deleteProject(projectId);
      if (result.success) {
        // Refresh project list
        const updatedProjects = await projectManager.getProjectList();
        setProjects(updatedProjects);
      }
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1500
    }}>
      <div style={{
        background: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '24px',
        minWidth: '400px',
        maxWidth: '600px',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        <h2 style={{ color: '#fff', marginBottom: '20px', fontSize: '18px' }}>
          {action === 'save' ? '💾 Save Project' : '📁 Load Project'}
        </h2>

        {action === 'save' && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Project Name:
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name..."
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  background: '#1a1a1a',
                  color: '#fff',
                  fontSize: '14px'
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  background: 'transparent',
                  color: '#ccc',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!projectName.trim()}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  background: projectName.trim() ? '#8b5cf6' : '#444',
                  color: '#fff',
                  cursor: projectName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Save Project
              </button>
            </div>
          </form>
        )}

        {action === 'load' && (
          <div>
            {loading ? (
              <div style={{ color: '#ccc', textAlign: 'center', padding: '20px' }}>
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <div style={{ color: '#ccc', textAlign: 'center', padding: '20px' }}>
                No saved projects found
              </div>
            ) : (
              <div style={{ marginBottom: '16px' }}>
                {projects.map(project => (
                  <div
                    key={project.id}
                    style={{
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      padding: '12px',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ color: '#fff', fontWeight: '500', marginBottom: '4px' }}>
                        {project.name}
                      </div>
                      <div style={{ color: '#999', fontSize: '12px' }}>
                        {new Date(project.lastModified).toLocaleString()} • 
                        {project.itemCount} timeline items • {project.sourceCount} source files
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleLoadProject(project.id)}
                        style={{
                          padding: '6px 12px',
                          border: 'none',
                          borderRadius: '4px',
                          background: '#8b5cf6',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteProject(project.id, project.name)}
                        style={{
                          padding: '6px 8px',
                          border: '1px solid #ef4444',
                          borderRadius: '4px',
                          background: 'transparent',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onCancel}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  background: 'transparent',
                  color: '#ccc',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App; 