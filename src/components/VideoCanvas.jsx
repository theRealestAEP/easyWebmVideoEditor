import React, { useRef, useEffect, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import { MediaProcessor } from '../utils/MediaProcessor';

const VideoCanvas = ({ 
  mediaItems, 
  currentTime, 
  isPlaying, 
  selectedItem, 
  onItemSelect, 
  onItemUpdate,
  canvasWidth = 1920,
  canvasHeight = 1080,
  exportMode = false
}) => {
  const canvasRef = useRef();
  const fabricCanvas = useRef();
  const containerRef = useRef();
  const mediaProcessor = useRef(new MediaProcessor());
  
  // Canvas dimensions from props
  const CANVAS_WIDTH = canvasWidth;
  const CANVAS_HEIGHT = canvasHeight;
  
  const [displaySize, setDisplaySize] = useState(() => {
    // Calculate initial display size maintaining aspect ratio
    const canvasAspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
    const baseWidth = 800; // Base width for initial display
    const calculatedHeight = baseWidth / canvasAspectRatio;
    return { width: baseWidth, height: calculatedHeight };
  });
  const [scale, setScale] = useState(1);
  const [processingStatus, setProcessingStatus] = useState('');
  const [queueStatus, setQueueStatus] = useState({ queueLength: 0, isProcessing: false, totalInProgress: 0 });
  const fabricObjects = useRef(new Map()); // Track fabric objects by media item ID
  const mediaProcessors = useRef(new Map()); // Frame-based processors
  const animationFrame = useRef();
  const isModifyingObject = useRef(false); // Flag to prevent updates during modifications
  const lastUpdateTime = useRef(Date.now());
  const [isDragging, setIsDragging] = useState(false);
  const previousCanvasDimensions = useRef({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

  // Detect rapid updates (drag operations)
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime.current;
    lastUpdateTime.current = now;
    
    if (timeSinceLastUpdate < 100) {
      setIsDragging(true);
      
      const resetTimer = setTimeout(() => {
        setIsDragging(false);
      }, 200);
      
      return () => clearTimeout(resetTimer);
    }
  }, [mediaItems]);

  // Force canvas refresh when dragging ends
  useEffect(() => {
    if (!isDragging && fabricCanvas.current) {
      console.log('Dragging ended - force canvas refresh');
      // Clear all objects and let the main update effect repopulate
      fabricCanvas.current.clear();
      fabricObjects.current.clear();
    }
  }, [isDragging]);

  // Update queue status periodically
  useEffect(() => {
    const updateQueueStatus = () => {
      const status = mediaProcessor.current.getQueueStatus();
      setQueueStatus(status);
      
      if (status.totalInProgress > 0) {
        // Only update if we don't already have a specific progress message
        if (!processingStatus.includes('(') && !processingStatus.includes('%')) {
          setProcessingStatus(`Processing ${status.totalInProgress} file${status.totalInProgress > 1 ? 's' : ''}...`);
        }
      } else if (status.totalInProgress === 0) {
        // Clear any processing-related messages when queue is empty
        if (processingStatus.includes('Processing') || 
            processingStatus.includes('Frames extracted') || 
            processingStatus.includes('Analyzing') ||
            processingStatus.includes('(100%)')) {
          setProcessingStatus('');
        }
      }
    };

    const interval = setInterval(updateQueueStatus, 500);
    return () => clearInterval(interval);
  }, [processingStatus]);

  // Process media item and extract frames
  const processMediaItem = useCallback(async (item) => {
    if (mediaProcessors.current.has(item.id)) {
      return mediaProcessors.current.get(item.id);
    }

    console.log('🎬 Processing media item:', item.name);

    try {
      const frameData = await mediaProcessor.current.extractFrames(
        item,
        (progress, status) => {
          setProcessingStatus(`${status} (${Math.round(progress)}%)`);
        }
      );

      const processor = mediaProcessor.current.createProcessor(item, frameData);
      mediaProcessors.current.set(item.id, processor);
      
      console.log('✅ Media processed successfully:', item.name, 
                 'Frames:', frameData.frameCount, 
                 'Actual duration:', frameData.duration,
                 'Original duration:', item.duration);
      
      // Update the media item with the actual duration from frame extraction
      if (Math.abs(frameData.duration - item.duration) > 0.1) { // Only update if significantly different
        console.log('🔄 Updating duration for', item.name, 'from', item.duration, 'to', frameData.duration);
        const updatedItem = { ...item, duration: frameData.duration };
        onItemUpdate(updatedItem);
      }
      
      // Clear processing status after successful completion
      setTimeout(() => {
        const currentStatus = mediaProcessor.current.getQueueStatus();
        if (currentStatus.totalInProgress === 0) {
          setProcessingStatus('');
        }
      }, 1000); // Give a brief moment to show completion, then clear
      
      return processor;
    } catch (error) {
      console.error('❌ Failed to process media:', item.name, error);
      setProcessingStatus(`Failed to process ${item.name}`);
      setTimeout(() => setProcessingStatus(''), 3000);
      return null;
    }
  }, [onItemUpdate]);

  // Get current frame image element with actual PNG scaling
  const getCurrentFrameImage = useCallback((item, relativeTime) => {
    const processor = mediaProcessors.current.get(item.id);
    if (!processor) {
      console.log('No processor for:', item.name);
      return null;
    }

    try {
      // Check if media should be visible at this time
      if (!processor.isVisibleAtTime(relativeTime)) {
        console.log('Media not visible:', item.name, 'time:', relativeTime, 'duration:', processor.duration);
        return null; // Hide media when it's outside its duration
      }
      
      // Clamp relativeTime to valid bounds for timeline operations
      const clampedTime = Math.max(0, Math.min(relativeTime, processor.duration - 0.1));
      const frame = processor.getCurrentFrame(relativeTime);
      if (!frame) {
        console.log('No frame available for:', item.name, 'at time:', relativeTime);
        return null; // No frame available
      }

      // Create image element from the frame
      const originalImg = new Image();
      originalImg.src = frame.url;
      originalImg.crossOrigin = 'anonymous';
      
      // Check if we need to scale the PNG
      if (originalImg.complete) {
        return createScaledImage(originalImg, item.width, item.height);
      } else {
        return new Promise((resolve) => {
          originalImg.onload = () => {
            resolve(createScaledImage(originalImg, item.width, item.height));
          };
        });
      }
      
    } catch (error) {
      console.warn('Error getting frame for:', item.name, error);
      return null;
    }
  }, []);

  // Helper function to create scaled PNG image
  const createScaledImage = useCallback((originalImg, targetWidth, targetHeight) => {
    // If dimensions match, return original
    if (originalImg.width === targetWidth && originalImg.height === targetHeight) {
      console.log('No scaling needed for frame');
      return originalImg;
    }

    console.log('Scaling PNG frame from', originalImg.width, 'x', originalImg.height, 
               'to', targetWidth, 'x', targetHeight);

    // Create canvas for scaling
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    
    // Use high-quality scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw scaled image
    ctx.drawImage(originalImg, 0, 0, targetWidth, targetHeight);
    
    // Create new image from scaled canvas
    const scaledImg = new Image();
    scaledImg.src = canvas.toDataURL('image/png');
    scaledImg.crossOrigin = 'anonymous';
    
    return scaledImg;
  }, []);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current || fabricCanvas.current) return;

    console.log('Initializing Fabric canvas with fixed size:', CANVAS_WIDTH, 'x', CANVAS_HEIGHT);
    fabricCanvas.current = new fabric.Canvas(canvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: 'rgba(0,0,0,0)',
      selection: true,
      preserveObjectStacking: true,
      interactive: true
    });

    const canvas = fabricCanvas.current;

    // Handle object selection
    canvas.on('selection:created', (e) => {
      const obj = e.selected[0];
      if (obj && obj.mediaItem) {
        onItemSelect(obj.mediaItem);
      }
    });

    canvas.on('selection:updated', (e) => {
      const obj = e.selected[0];
      if (obj && obj.mediaItem) {
        onItemSelect(obj.mediaItem);
      }
    });

    canvas.on('selection:cleared', () => {
      onItemSelect(null);
    });

    // Handle object modifications with proper scaling
    canvas.on('object:modified', (e) => {
      const obj = e.target;
      if (obj && obj.mediaItem) {
        const item = obj.mediaItem;
        
        // Calculate actual dimensions after scaling
        const actualWidth = obj.width * obj.scaleX;
        const actualHeight = obj.height * obj.scaleY;
        
        console.log('Object being modified:', item.name, 
                   'Old size:', item.width, 'x', item.height,
                   'New size:', actualWidth, 'x', actualHeight);
        
        const updatedItem = {
          ...item,
          x: obj.left,
          y: obj.top,
          width: actualWidth,
          height: actualHeight,
          rotation: obj.angle,
          opacity: obj.opacity
        };
        
        // Mark object as recently modified BEFORE updating
        obj._lastModified = Date.now();
        obj._userModified = true;
        
        // Update the fabric object to use the new dimensions with scale 1
        obj.set({
          width: actualWidth,
          height: actualHeight,
          scaleX: 1,
          scaleY: 1
        });
        
        // Update the mediaItem reference on the object
        obj.mediaItem = updatedItem;
        
        console.log('Object modification complete:', updatedItem.name);
        
        canvas.renderAll();
        
        // Update the stored media item AFTER fabric object is updated
        // Use setTimeout to prevent immediate re-render interference
        setTimeout(() => {
          onItemUpdate(updatedItem);
        }, 0);
      }
    });

    canvas.on('object:scaling', (e) => {
      // Mark as being modified to prevent interference
      const obj = e.target;
      if (obj) {
        obj._userModified = true;
        obj._lastModified = Date.now();
      }
      isModifyingObject.current = true;
      setTimeout(() => {
        isModifyingObject.current = false;
      }, 200);
    });

    canvas.on('object:moving', (e) => {
      const obj = e.target;
      if (obj && obj.mediaItem) {
        const item = obj.mediaItem;
        const updatedItem = {
          ...item,
          x: obj.left,
          y: obj.top
        };
        onItemUpdate(updatedItem);
      }
    });

    return () => {
      if (fabricCanvas.current) {
        fabricCanvas.current.dispose();
        fabricCanvas.current = null;
      }
      
      // Clean up processors
      mediaProcessors.current.clear();
      fabricObjects.current.clear();
    };
  }, [onItemSelect, onItemUpdate]);

  // Handle export mode changes
  useEffect(() => {
    if (fabricCanvas.current) {
      const canvas = fabricCanvas.current;
      
      // Clear any active selections when entering export mode
      if (exportMode) {
        canvas.discardActiveObject();
      }
      
      // Update all existing objects with new export mode settings
      canvas.getObjects().forEach(obj => {
        obj.set({
          selectable: !exportMode,
          hasControls: !exportMode,
          hasBorders: !exportMode,
          hasRotatingPoint: !exportMode,
          evented: !exportMode
        });
      });
      
      // Update canvas-level settings
      canvas.selection = !exportMode;
      canvas.interactive = !exportMode;
      
      // Force re-render
      canvas.renderAll();
      
      console.log('Canvas updated for export mode:', exportMode, 'Objects:', canvas.getObjects().length);
    }
  }, [exportMode]);

  // Process all media items when they change
  useEffect(() => {
    // Filter out audio items - they don't need visual processing
    const visualMediaItems = mediaItems.filter(item => item.type !== 'audio');
    console.log('Processing visual media items:', visualMediaItems.length);
    
    const processAllMedia = async () => {
      for (const item of visualMediaItems) {
        if (!mediaProcessors.current.has(item.id)) {
          await processMediaItem(item);
        }
      }
    };
    
    processAllMedia();
  }, [mediaItems, processMediaItem]);

  // Update canvas objects with frame-accurate rendering
  useEffect(() => {
    if (!fabricCanvas.current) return;
    
    // Skip updates if user is currently modifying objects ON THE CANVAS
    // But allow updates during timeline drag operations
    if (isModifyingObject.current) {
      console.log('Skipping canvas update - object being modified');
      return;
    }

    const canvas = fabricCanvas.current;
    
    // Filter out audio items and filter active items based on ACTUAL processor durations
    const visualMediaItems = mediaItems.filter(item => item.type !== 'audio');
    
    // Show all visual items during timeline operations for immediate updates
    const activeItems = isDragging ? visualMediaItems : visualMediaItems.filter(item => {
      const processor = mediaProcessors.current.get(item.id);
      const actualDuration = processor ? processor.duration : item.duration;
      
      return currentTime >= item.startTime && 
             currentTime < item.startTime + actualDuration;
    });

    console.log('Updating canvas. Current time:', currentTime, 'Active visual items:', activeItems.length);

    // Remove objects that are no longer active OR have no valid frame
    const currentObjects = canvas.getObjects();
    currentObjects.forEach(obj => {
      if (obj.mediaItem) {
        const processor = mediaProcessors.current.get(obj.mediaItem.id);
        const actualDuration = processor ? processor.duration : obj.mediaItem.duration;
        const relativeTime = currentTime - obj.mediaItem.startTime;
        
        // Check if item is still in timeline bounds
        const isInTimeBounds = currentTime >= obj.mediaItem.startTime && 
                              currentTime < obj.mediaItem.startTime + actualDuration;
        
        // Check if processor says it's visible
        const isVisibleByProcessor = processor ? processor.isVisibleAtTime(relativeTime) : true;
        
        // Check if item still exists in current mediaItems
        const stillExists = visualMediaItems.some(item => item.id === obj.mediaItem.id);
        
        const shouldRemove = isDragging ? !stillExists : (!stillExists || !isInTimeBounds || !isVisibleByProcessor);
        
        if (shouldRemove) {
          console.log('Removing object:', obj.mediaItem.name, 
                     'InTimeBounds:', isInTimeBounds, 
                     'VisibleByProcessor:', isVisibleByProcessor,
                     'RelativeTime:', relativeTime,
                     'ActualDuration:', actualDuration);
          canvas.remove(obj);
          fabricObjects.current.delete(obj.mediaItem.id);
        }
      }
    });

    // Add or update active items that have valid frames
    activeItems.forEach((item) => {
      const relativeTime = currentTime - item.startTime;
      const processor = mediaProcessors.current.get(item.id);
      
      if (!processor) {
        console.warn('No processor found for:', item.name, '- still processing...');
        return;
      }

      // Get frame - if null, skip this item entirely
      const frameImgResult = getCurrentFrameImage(item, relativeTime);
      
      // Handle both sync and async results
      const processFrameImage = (frameImg) => {
        if (!frameImg) {
          console.log('No frame available for:', item.name, 'at time:', relativeTime, '- skipping');
          return;
        }

        let existingObject = fabricObjects.current.get(item.id);
        
        if (existingObject) {
          // Check if object was recently modified by user
          const isRecentlyModified = existingObject._lastModified && 
                                    (Date.now() - existingObject._lastModified < 3000);
          const isUserModified = existingObject._userModified;
          
          // Check if the stored item dimensions match the current object dimensions
          const currentActualWidth = existingObject.width * existingObject.scaleX;
          const currentActualHeight = existingObject.height * existingObject.scaleY;
          const dimensionsMatch = Math.abs(currentActualWidth - item.width) < 1 && 
                                 Math.abs(currentActualHeight - item.height) < 1;
          
          console.log('Updating existing object:', item.name,
                     'Recently modified:', isRecentlyModified,
                     'User modified:', isUserModified,
                     'Dimensions match:', dimensionsMatch,
                     'Current:', currentActualWidth, 'x', currentActualHeight,
                     'Stored:', item.width, 'x', item.height);
          
          // Always update position, rotation, opacity
          const updateProps = {
            left: item.x,
            top: item.y,
            angle: item.rotation,
            opacity: item.opacity,
            // Update UI controls based on export mode
            selectable: !exportMode,
            hasControls: !exportMode,
            hasBorders: !exportMode,
            hasRotatingPoint: !exportMode,
            evented: !exportMode
          };
          
          // For PNG scaling, we always want the object to match the item size
          // The scaling is already done at the PNG level
          updateProps.width = item.width;
          updateProps.height = item.height;
          updateProps.scaleX = 1;
          updateProps.scaleY = 1;
          
          existingObject.set(updateProps);
          
          // Always update the mediaItem reference to keep it current
          // but preserve the modification flags
          const wasUserModified = existingObject._userModified;
          const lastModified = existingObject._lastModified;
          existingObject.mediaItem = item;
          if (wasUserModified) {
            existingObject._userModified = true;
            existingObject._lastModified = lastModified;
          }
          
          // Force immediate canvas render to prevent artifacts during drag
          canvas.renderAll();
          
          // Update frame for animated media with scaled PNG
          if (processor.isAnimated && frameImg.src) {
            const updateFrame = () => {
              try {
                existingObject.setElement(frameImg);
                existingObject.dirty = true;
                canvas.renderAll();
              } catch (error) {
                console.warn('Failed to update frame for:', item.name, error);
              }
            };

            if (frameImg.complete) {
              updateFrame();
            } else {
              frameImg.onload = updateFrame;
            }
          }
          
          return;
        }

        // Create new object with scaled PNG
        console.log('Adding scaled media to canvas:', item.name, 'Processor type:', processor.type);
        
        const createFabricObject = () => {
          try {
            const fabricObject = new fabric.Image(frameImg, {
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              angle: item.rotation,
              opacity: item.opacity,
              scaleX: 1,
              scaleY: 1,
              selectable: !exportMode,
              hasControls: !exportMode,
              hasBorders: !exportMode,
              hasRotatingPoint: !exportMode,
              evented: !exportMode
            });
            
            fabricObject.mediaItem = item;
            fabricObject._processorType = processor.type;
            canvas.add(fabricObject);
            fabricObjects.current.set(item.id, fabricObject);
            
            // Handle selection only when not in export mode
            if (!exportMode && selectedItem && selectedItem.id === item.id) {
              canvas.setActiveObject(fabricObject);
            }
            
            canvas.renderAll();
          } catch (error) {
            console.error('Failed to create fabric object for:', item.name, error);
          }
        };
        
        if (frameImg.complete) {
          createFabricObject();
        } else {
          frameImg.onload = createFabricObject;
        }
      };

      // Handle both Promise and direct results
      if (frameImgResult && typeof frameImgResult.then === 'function') {
        frameImgResult.then(processFrameImage);
      } else {
        processFrameImage(frameImgResult);
      }
    });

    // Final cleanup and canvas render
    canvas.renderAll();
    
    // During drag operations, force additional cleanup
    if (isDragging) {
      // Clear any cached rendering to prevent artifacts
      canvas.getObjects().forEach(obj => {
        if (obj.mediaItem) {
          obj.dirty = true;
        }
      });
      // Force another render for drag operations
      setTimeout(() => canvas.renderAll(), 0);
    }

  }, [mediaItems, currentTime, selectedItem, getCurrentFrameImage, isDragging]);

  // Update display size when canvas dimensions change
  useEffect(() => {
    // Calculate initial display size maintaining aspect ratio
    const canvasAspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
    const baseWidth = 800; // Base width for initial display
    const calculatedHeight = baseWidth / canvasAspectRatio;
    const newDisplaySize = { width: baseWidth, height: calculatedHeight };
    
    setDisplaySize(newDisplaySize);
    setScale(newDisplaySize.width / CANVAS_WIDTH);
    
    // Trigger a resize to recalculate properly
    setTimeout(() => {
      handleResize();
    }, 0);
  }, [CANVAS_WIDTH, CANVAS_HEIGHT]);

  // Animation loop for smooth frame updates during playback
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        if (fabricCanvas.current) {
          const objects = fabricCanvas.current.getObjects();
          
          objects.forEach(obj => {
            if (obj.mediaItem && obj.mediaItem.type !== 'audio') { // Skip audio items
              const processor = mediaProcessors.current.get(obj.mediaItem.id);
              if (processor && processor.isAnimated) {
                const relativeTime = currentTime - obj.mediaItem.startTime;
                const actualDuration = processor.duration;
                
                // Check timeline bounds
                const isInTimeBounds = currentTime >= obj.mediaItem.startTime && 
                                      currentTime < obj.mediaItem.startTime + actualDuration;
                
                // Check processor visibility
                const isVisibleByProcessor = processor.isVisibleAtTime(relativeTime);
                
                if (!isInTimeBounds || !isVisibleByProcessor) {
                  console.log('Removing object during animation:', obj.mediaItem.name, 
                             'InTimeBounds:', isInTimeBounds, 
                             'VisibleByProcessor:', isVisibleByProcessor);
                  fabricCanvas.current.remove(obj);
                  fabricObjects.current.delete(obj.mediaItem.id);
                  return;
                }
                
                const frameImgResult = getCurrentFrameImage(obj.mediaItem, relativeTime);
                
                const updateAnimationFrame = (frameImg) => {
                  if (frameImg && frameImg.src && obj.getElement().src !== frameImg.src) {
                    const updateFrame = () => {
                      try {
                        obj.setElement(frameImg);
                        obj.dirty = true;
                        fabricCanvas.current.renderAll();
                      } catch (error) {
                        console.warn('Animation frame update failed:', obj.mediaItem.name, error);
                      }
                    };
                    
                    if (frameImg.complete) {
                      updateFrame();
                    } else {
                      frameImg.onload = updateFrame;
                    }
                  } else if (!frameImg) {
                    // No frame available - remove object
                    console.log('No frame during animation, removing:', obj.mediaItem.name);
                    fabricCanvas.current.remove(obj);
                    fabricObjects.current.delete(obj.mediaItem.id);
                  }
                };

                // Handle both Promise and direct results
                if (frameImgResult && typeof frameImgResult.then === 'function') {
                  frameImgResult.then(updateAnimationFrame);
                } else {
                  updateAnimationFrame(frameImgResult);
                }
              }
            }
          });
        }
        animationFrame.current = requestAnimationFrame(animate);
      };
      animationFrame.current = requestAnimationFrame(animate);
    } else {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    }

    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [isPlaying, currentTime, getCurrentFrameImage]);

  // Handle canvas resize and scaling
  const handleResize = useCallback(() => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Reserve space for timeline (reduced from 190px to 80px)
    const reservedTimelineSpace = 80;
    const availableHeight = containerHeight - reservedTimelineSpace;
    const availableWidth = containerWidth;
    
    // Calculate the aspect ratio of the canvas
    const canvasAspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
    const availableAspectRatio = availableWidth / availableHeight;
    
    let displayWidth, displayHeight;
    
    // Fit canvas to available space while maintaining aspect ratio
    if (canvasAspectRatio > availableAspectRatio) {
      // Canvas is wider than available space - constrain by width
      displayWidth = availableWidth;
      displayHeight = availableWidth / canvasAspectRatio;
    } else {
      // Canvas is taller than available space - constrain by height
      displayHeight = availableHeight;
      displayWidth = availableHeight * canvasAspectRatio;
    }
    
    // Calculate scale based on the display dimensions
    const scaleX = displayWidth / CANVAS_WIDTH;
    const scaleY = displayHeight / CANVAS_HEIGHT;
    const newScale = Math.min(scaleX, scaleY);
    
    setDisplaySize({ width: displayWidth, height: displayHeight });
    setScale(newScale);
    
    // Update Fabric.js canvas if it exists
    if (fabricCanvas.current) {
      fabricCanvas.current.setZoom(newScale);
      fabricCanvas.current.setWidth(displayWidth);
      fabricCanvas.current.setHeight(displayHeight);
    }
    
  }, [CANVAS_WIDTH, CANVAS_HEIGHT]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Clear old user modification flags periodically
  useEffect(() => {
    const clearOldFlags = () => {
      if (fabricCanvas.current) {
        const objects = fabricCanvas.current.getObjects();
        objects.forEach(obj => {
          if (obj._userModified && obj._lastModified) {
            // Clear user modified flag after 10 seconds
            if (Date.now() - obj._lastModified > 10000) {
              obj._userModified = false;
              console.log('Cleared user modification flag for:', obj.mediaItem?.name);
            }
          }
        });
      }
    };

    const interval = setInterval(clearOldFlags, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div ref={containerRef} className="canvas-area">
      <div style={{
        width: displaySize.width,
        height: displaySize.height,
        background: '#222',
        border: '2px solid #555',
        borderRadius: '8px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <canvas
          ref={canvasRef}
          className="video-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{
            display: 'block',
            width: displaySize.width,
            height: displaySize.height,
          }}
        />
        
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          pointerEvents: 'none'
        }}>
          1920×1080 • Scale: {(scale * 100).toFixed(0)}% • Playing: {isPlaying ? 'Yes' : 'No'}
        </div>
        
        {processingStatus && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '16px 24px',
            borderRadius: '8px',
            fontSize: '14px',
            textAlign: 'center',
            pointerEvents: 'none',
            minWidth: '200px'
          }}>
            <div>{processingStatus}</div>
            {queueStatus.totalInProgress > 1 && (
              <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>
                Queue: {queueStatus.queueLength} waiting
              </div>
            )}
          </div>
        )}
        
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          pointerEvents: 'none'
        }}>
          Canvas: {CANVAS_WIDTH}x{CANVAS_HEIGHT} • Frame-Based Media System
        </div>
      </div>
      
      {mediaItems.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#666',
          fontSize: '18px',
          pointerEvents: 'none',
          textAlign: 'center'
        }}>
          Drop media files here or use the "Add Media" button<br/>
          <span style={{ fontSize: '14px', opacity: 0.7 }}>
            Supports: MP4, WebM, GIF, WebP, PNG, JPG
          </span>
        </div>
      )}
    </div>
  );
};

export default VideoCanvas; 