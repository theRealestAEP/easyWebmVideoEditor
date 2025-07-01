import React, { useRef, useEffect, useCallback, useState } from 'react';

const Timeline = ({ 
  mediaItems, 
  currentTime, 
  duration, 
  isPlaying,
  onTimeUpdate, 
  onPlayPause,
  onItemsUpdate,
  onDurationChange,
  playbackFrameRate = 15, // Default to 15fps if not provided
  restoreFileForItem // Function to restore File objects for uploaded media
}) => {
  const timelineRef = useRef();
  const [isDragging, setIsDragging] = useState(false);
  const [dragItem, setDragItem] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [scale, setScale] = useState(20); // pixels per second
  const playbackInterval = useRef();
  const [lockedTracks, setLockedTracks] = useState(new Set()); // Track locked items
  const [selectedItems, setSelectedItems] = useState(new Set()); // Multi-select support
  const [copiedItems, setCopiedItems] = useState([]); // Copy/paste buffer
  const [contextMenu, setContextMenu] = useState(null); // Right-click context menu
  const [dragTargetTrack, setDragTargetTrack] = useState(null); // Track being targeted during drag
  const audioElements = useRef(new Map()); // Store audio elements for playback
  const dragStartMouseX = useRef(null); // Store mouse X when multi-select drag starts
  const dragStartPositions = useRef(new Map()); // Store original positions when multi-select drag starts

  // Playback timer
  useEffect(() => {
    if (isPlaying) {
      const frameInterval = 1000 / playbackFrameRate; // Convert FPS to milliseconds
      const timeStep = 1 / playbackFrameRate; // Time step per frame
      
      playbackInterval.current = setInterval(() => {
        onTimeUpdate(prev => {
          const next = prev + timeStep;
          return next >= duration ? 0 : next;
        });
      }, frameInterval);
    } else {
      clearInterval(playbackInterval.current);
    }

    return () => clearInterval(playbackInterval.current);
  }, [isPlaying, duration, onTimeUpdate, playbackFrameRate]);

  // Audio playback management
  useEffect(() => {
    const audioItems = mediaItems.filter(item => item.type === 'audio');
    
    // Create audio elements for new audio items
    audioItems.forEach(item => {
      if (!audioElements.current.has(item.id)) {
        const audio = new Audio(item.url);
        audio.preload = 'auto';
        audioElements.current.set(item.id, audio);
      }
    });

    // Remove audio elements for deleted items
    const currentAudioIds = new Set(audioItems.map(item => item.id));
    for (const [id, audio] of audioElements.current.entries()) {
      if (!currentAudioIds.has(id)) {
        audio.pause();
        audioElements.current.delete(id);
      }
    }

    // Update audio playback based on timeline state
    audioItems.forEach(item => {
      const audio = audioElements.current.get(item.id);
      if (!audio) return;

      const itemStartTime = item.startTime;
      const itemEndTime = item.startTime + item.duration;
      const shouldPlay = isPlaying && currentTime >= itemStartTime && currentTime < itemEndTime;

      if (shouldPlay) {
        const audioTime = currentTime - itemStartTime;
        const timeDiff = Math.abs(audio.currentTime - audioTime);
        
        // Sync audio time if it's off by more than 0.2 seconds
        if (timeDiff > 0.2) {
          audio.currentTime = audioTime;
        }
        
        if (audio.paused) {
          audio.play().catch(console.warn);
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    });

    return () => {
      // Cleanup audio elements when component unmounts
      for (const audio of audioElements.current.values()) {
        audio.pause();
      }
    };
  }, [mediaItems, isPlaying, currentTime]);

  // Generate time markers for the ruler
  const generateTimeMarkers = useCallback(() => {
    const markers = [];
    const interval = scale < 10 ? 10 : scale < 20 ? 5 : 1; // Adjust interval based on zoom
    
    for (let time = 0; time <= duration; time += interval) {
      const left = time * scale;
      const isMainMarker = time % (interval * 5) === 0;
      const isMajorMarker = time % (interval * 10) === 0;
      
      markers.push(
        <div
          key={time}
          style={{
            position: 'absolute',
            left: `${left}px`,
            top: isMajorMarker ? '0' : isMainMarker ? '8px' : '12px',
            width: '1px',
            height: isMajorMarker ? '32px' : isMainMarker ? '24px' : '20px',
            backgroundColor: isMajorMarker ? '#555' : isMainMarker ? '#444' : '#333',
            pointerEvents: 'none'
          }}
        />
      );
      
      if (isMajorMarker) {
        markers.push(
          <div
            key={`label-${time}`}
            style={{
              position: 'absolute',
              left: `${left + 3}px`,
              top: '2px',
              fontSize: '10px',
              color: '#888',
              pointerEvents: 'none',
              fontFamily: 'monospace'
            }}
          >
            {Math.floor(time / 60)}:{(time % 60).toString().padStart(2, '0')}
          </div>
        );
      }
    }
    
    return markers;
  }, [duration, scale]);

  // Handle timeline click for scrubbing
  const handleTimelineClick = useCallback((e) => {
    if (isDragging) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(duration, clickX / scale));
    onTimeUpdate(newTime);
    
    // Deselect all items when clicking on empty timeline
    setSelectedItems(new Set());
  }, [scale, duration, onTimeUpdate, isDragging]);

  // Handle drop from source media
  const handleTimelineDrop = useCallback((e) => {
    e.preventDefault();
    
    // Deselect all items when dropping new media
    setSelectedItems(new Set());
    
    try {
      const droppedData = e.dataTransfer.getData('text/plain');
      if (!droppedData) return;
      
      const sourceItem = JSON.parse(droppedData);
      console.log('Dropped source item onto timeline:', sourceItem);
      
      // Calculate drop position
      const rect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const dropY = e.clientY - rect.top;
      const dropTime = Math.max(0, dropX / scale);
      
      // Calculate which track to drop into
      const timelineHeaderHeight = 25;
      const trackHeight = 60;
      const mouseYInTracks = dropY - timelineHeaderHeight;
      const targetTrackIndex = Math.floor(mouseYInTracks / trackHeight);
      
      // Create timeline item from source item
      const timelineItem = {
        ...sourceItem,
        id: Date.now() + Math.random(), // New ID for timeline
        sourceId: sourceItem.id, // Keep reference to original source item for File restoration
        startTime: Math.round(dropTime * 10) / 10, // Snap to 0.1s grid
        x: 100, // Default canvas position
        y: 100,
        width: sourceItem.type === 'video' || sourceItem.subtype === 'gif' || sourceItem.subtype === 'sticker' ? 320 : 200,
        height: sourceItem.type === 'video' || sourceItem.subtype === 'gif' || sourceItem.subtype === 'sticker' ? 180 : 150,
        rotation: 0,
        opacity: 1,
        // Force track if dropped in specific area
        forceTrackIndex: targetTrackIndex >= 0 ? targetTrackIndex : undefined
      };
      
      // Restore File object if this came from uploaded media and we have a restore function
      const restoredItem = restoreFileForItem ? restoreFileForItem(timelineItem) : timelineItem;
      
      console.log('Creating timeline item:', restoredItem);
      
      // Add to timeline
      const updatedItems = [...mediaItems, restoredItem];
      onItemsUpdate(updatedItems);
      
    } catch (error) {
      console.error('Error handling timeline drop:', error);
    }
  }, [scale, mediaItems, onItemsUpdate, restoreFileForItem]);

  const handleTimelineDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Calculate which track each item should be on (avoiding overlaps)
  const calculateTrackAssignments = useCallback((items) => {
    // Separate audio and video items
    const audioItems = items.filter(item => item.type === 'audio');
    const videoItems = items.filter(item => item.type !== 'audio');
    
    const audioTracks = [];
    const videoTracks = [];
    
    // Process audio items
    const sortedAudioItems = [...audioItems].sort((a, b) => a.startTime - b.startTime);
    sortedAudioItems.forEach(item => {
      const itemEnd = item.startTime + item.duration;
      
      // Handle forced track assignments for audio items
      if (item.forceTrackIndex !== undefined) {
        const targetTrack = item.forceTrackIndex;
        
        // Only assign to audio track range (0 to audioItems.length - 1)
        // If trying to force to a video track area, let it fall through to normal assignment
        const maxAudioTrackIndex = Math.max(audioItems.length - 1, 0);
        if (targetTrack <= maxAudioTrackIndex) {
          // Ensure we have enough audio tracks
          while (audioTracks.length <= targetTrack) {
            audioTracks.push([]);
          }
          
          audioTracks[targetTrack].push({ ...item, trackIndex: targetTrack, trackType: 'audio', forceTrackIndex: undefined });
          return;
        }
      }
      
      // Find the first audio track where this item fits without overlap
      let assignedTrack = -1;
      for (let trackIndex = 0; trackIndex < audioTracks.length; trackIndex++) {
        const track = audioTracks[trackIndex];
        const hasOverlap = track.some(trackItem => {
          const trackItemEnd = trackItem.startTime + trackItem.duration;
          return !(item.startTime >= trackItemEnd || itemEnd <= trackItem.startTime);
        });
        
        if (!hasOverlap) {
          assignedTrack = trackIndex;
          break;
        }
      }
      
      // If no existing track works, create a new one
      if (assignedTrack === -1) {
        assignedTrack = audioTracks.length;
        audioTracks.push([]);
      }
      
      audioTracks[assignedTrack].push({ ...item, trackIndex: assignedTrack, trackType: 'audio', forceTrackIndex: undefined });
    });
    
    // Process video items
    const sortedVideoItems = [...videoItems].sort((a, b) => a.startTime - b.startTime);
    sortedVideoItems.forEach(item => {
      const itemEnd = item.startTime + item.duration;
      
      // Handle forced track assignments for video items
      if (item.forceTrackIndex !== undefined) {
        const targetTrack = item.forceTrackIndex;
        
        // Convert absolute track index to video track index (subtract audio tracks)
        const videoTrackIndex = targetTrack - audioTracks.length;
        
        // Only assign if targeting video track area (after audio tracks)
        if (videoTrackIndex >= 0) {
        // Ensure we have enough video tracks
          while (videoTracks.length <= videoTrackIndex) {
          videoTracks.push([]);
        }
        
          videoTracks[videoTrackIndex].push({ ...item, trackIndex: videoTrackIndex, trackType: 'video', forceTrackIndex: undefined });
        return;
        }
      }
      
      // Find the first video track where this item fits without TIME overlap (not track overlap)
      let assignedTrack = -1;
      for (let trackIndex = 0; trackIndex < videoTracks.length; trackIndex++) {
        const track = videoTracks[trackIndex];
        const hasTimeOverlap = track.some(trackItem => {
          const trackItemEnd = trackItem.startTime + trackItem.duration;
          return !(item.startTime >= trackItemEnd || itemEnd <= trackItem.startTime);
        });
        
        if (!hasTimeOverlap) {
          assignedTrack = trackIndex;
          break;
        }
      }
      
      // If no existing track works, create a new one
      if (assignedTrack === -1) {
        assignedTrack = videoTracks.length;
        videoTracks.push([]);
      }
      
      videoTracks[assignedTrack].push({ ...item, trackIndex: assignedTrack, trackType: 'video', forceTrackIndex: undefined });
    });
    
    // Clean up empty tracks and reorganize
    const cleanedAudioTracks = audioTracks.filter(track => track.length > 0);
    const cleanedVideoTracks = videoTracks.filter(track => track.length > 0);
    
    // Update track indices after cleanup
    cleanedAudioTracks.forEach((track, trackIndex) => {
      track.forEach(item => {
        item.trackIndex = trackIndex;
        // Clear forceTrackIndex after assignment
        delete item.forceTrackIndex;
      });
    });
    
    cleanedVideoTracks.forEach((track, trackIndex) => {
      track.forEach(item => {
        item.trackIndex = trackIndex;
        // Clear forceTrackIndex after assignment
        delete item.forceTrackIndex;
      });
    });
    
    console.log('Track assignments - Audio tracks:', cleanedAudioTracks.length, 'Video tracks:', cleanedVideoTracks.length);
    
    return { audioTracks: cleanedAudioTracks, videoTracks: cleanedVideoTracks };
  }, []);

  // Get track assignments for current media items
  const trackAssignments = calculateTrackAssignments(mediaItems);

  // Handle mouse down on timeline items
  const handleItemMouseDown = useCallback((e, item) => {
    if (lockedTracks.has(item.id)) return; // Don't allow dragging locked items
    
    e.stopPropagation();
    
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const itemLeft = item.startTime * scale;
    
    setIsDragging(true);
    setDragItem(item);
    setDragOffset(mouseX - itemLeft);
    
    // Handle multi-select with Shift (not Ctrl)
    if (e.shiftKey) {
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        if (newSet.has(item.id)) {
          newSet.delete(item.id);
        } else {
          newSet.add(item.id);
        }
        return newSet;
      });
    } else {
      // If clicking on an already selected item (without Shift), maintain the multi-selection for dragging
      // If clicking on a non-selected item, select only that item
      setSelectedItems(prev => {
        if (prev.has(item.id) && prev.size > 1) {
          // Item is already selected and part of multi-selection, keep the current selection
          return prev;
        } else {
          // Item is not selected or is the only selected item, select only this item
          return new Set([item.id]);
        }
      });
    }
  }, [scale, lockedTracks]);

  // Handle mouse move for dragging with overlap prevention and track creation
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !dragItem) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check if we're doing multi-select drag
    const isMultiSelectDrag = selectedItems.has(dragItem.id) && selectedItems.size > 1;
    
    if (isMultiSelectDrag) {
      // Multi-select drag: simple mouse-based movement
      const selectedItemsList = mediaItems.filter(item => selectedItems.has(item.id));
      
      // Store the mouse position from when drag started (we need to track this)
      if (!dragStartMouseX.current) {
        dragStartMouseX.current = mouseX;
        dragStartPositions.current = new Map();
        selectedItemsList.forEach(item => {
          dragStartPositions.current.set(item.id, item.startTime);
        });
      }
      
      // Calculate how much mouse moved since drag started
      const mouseDelta = mouseX - dragStartMouseX.current;
      const timeDelta = mouseDelta / scale;
      
      // Don't allow any selected item to go negative
      if (selectedItemsList.some(item => {
        const originalTime = dragStartPositions.current.get(item.id);
        return originalTime + timeDelta < 0;
      })) {
        return;
      }
      
      // Check collision - same track only
      const nonSelectedItems = mediaItems.filter(item => !selectedItems.has(item.id));
      const currentTrackAssignments = calculateTrackAssignments(mediaItems);
      
      const wouldCollide = selectedItemsList.some(selectedItem => {
        const originalTime = dragStartPositions.current.get(selectedItem.id);
        const newItemTime = originalTime + timeDelta;
        const newItemEnd = newItemTime + selectedItem.duration;
        
        // Find track
        let selectedTrack = -1;
        let selectedType = '';
        
        currentTrackAssignments.audioTracks.forEach((track, trackIndex) => {
          if (track.some(item => item.id === selectedItem.id)) {
            selectedTrack = trackIndex;
            selectedType = 'audio';
          }
        });
        
        if (selectedType === '') {
          currentTrackAssignments.videoTracks.forEach((track, trackIndex) => {
            if (track.some(item => item.id === selectedItem.id)) {
              selectedTrack = trackIndex;
              selectedType = 'video';
            }
          });
        }
        
        return nonSelectedItems.some(nonSelectedItem => {
          let nonSelectedTrack = -1;
          let nonSelectedType = '';
          
          currentTrackAssignments.audioTracks.forEach((track, trackIndex) => {
            if (track.some(item => item.id === nonSelectedItem.id)) {
              nonSelectedTrack = trackIndex;
              nonSelectedType = 'audio';
            }
          });
          
          if (nonSelectedType === '') {
            currentTrackAssignments.videoTracks.forEach((track, trackIndex) => {
              if (track.some(item => item.id === nonSelectedItem.id)) {
                nonSelectedTrack = trackIndex;
                nonSelectedType = 'video';
              }
            });
          }
          
          if (selectedType !== nonSelectedType || selectedTrack !== nonSelectedTrack) {
            return false;
          }
          
          const nonSelectedEnd = nonSelectedItem.startTime + nonSelectedItem.duration;
          return !(newItemTime >= nonSelectedEnd || newItemEnd <= nonSelectedItem.startTime);
        });
      });
      
      if (wouldCollide) {
        return;
      }
      
      // Move all selected items to their new positions
      const updatedItems = mediaItems.map(item => {
        if (!selectedItems.has(item.id)) {
          return item;
        }
        
        const originalTime = dragStartPositions.current.get(item.id);
        const newItemTime = Math.max(0, originalTime + timeDelta);
        return {
          ...item,
          startTime: Math.round(newItemTime * 10) / 10
        };
      });
      
      onItemsUpdate(updatedItems);
      return;
    }
    
    // Single item drag - RESTORE ORIGINAL LOGIC
    const newStartTime = Math.max(0, (mouseX - dragOffset) / scale);
    
    // Calculate which track the mouse is over
    const timelineHeaderHeight = 25; // Height of the ruler
    const trackHeight = 60;
    const mouseYInTracks = mouseY - timelineHeaderHeight;
    const targetTrackIndex = Math.floor(mouseYInTracks / trackHeight);
    
    // Improved snapping to 0.1 second intervals
    const snappedTime = Math.round(newStartTime * 10) / 10;
    
    // Get other items excluding the one being dragged
    const otherItems = mediaItems.filter(item => item.id !== dragItem.id);
    
    // Separate track calculations for audio and video
    const currentTrackAssignments = calculateTrackAssignments(otherItems);
    const totalExistingTracks = currentTrackAssignments.audioTracks.length + currentTrackAssignments.videoTracks.length;
    const isNewTrackArea = targetTrackIndex >= totalExistingTracks;
    
    // Determine if we're dragging to an appropriate track type
    const isDraggingAudio = dragItem.type === 'audio';
    const audioTrackCount = currentTrackAssignments.audioTracks.length;
    const isInAudioTrackArea = targetTrackIndex < audioTrackCount;
    
    // For video/visual media, allow dropping on any video track or new track area
    // For audio, only allow dropping on audio tracks or new track area
    const isValidTrackType = isDraggingAudio ? 
      (isInAudioTrackArea || isNewTrackArea) : 
      (!isInAudioTrackArea || isNewTrackArea);
    
    // Set drag target for visual feedback
    if (targetTrackIndex >= 0) {
      setDragTargetTrack({
        index: targetTrackIndex,
        isNewTrack: isNewTrackArea,
        isValidTrackType,
        canPlaceHere: isValidTrackType || (!isDraggingAudio && !isInAudioTrackArea)
      });
    } else {
      setDragTargetTrack(null);
    }
    
    let finalTime = snappedTime;
    
    // ALWAYS do collision detection to prevent invalid placements
    // Determine the actual track where the item will be placed
    let actualTargetTrackIndex = targetTrackIndex;
    let willCreateNewTrack = false;
    
    // If dragging to an invalid track type, keep item on its current track
    if (!isValidTrackType && !isNewTrackArea) {
      // Find the current track of the dragged item
      const dragItemTrackAssignments = calculateTrackAssignments(mediaItems);
      let currentTrackIndex = -1;
      
      // Find which track the item is currently on
      dragItemTrackAssignments.audioTracks.forEach((track, trackIndex) => {
        if (track.some(item => item.id === dragItem.id)) {
          currentTrackIndex = trackIndex;
        }
      });
      
      if (currentTrackIndex === -1) {
        dragItemTrackAssignments.videoTracks.forEach((track, trackIndex) => {
          if (track.some(item => item.id === dragItem.id)) {
            currentTrackIndex = trackIndex + dragItemTrackAssignments.audioTracks.length;
          }
        });
      }
      
      if (currentTrackIndex !== -1) {
        actualTargetTrackIndex = currentTrackIndex;
      }
    } else if (isNewTrackArea && isValidTrackType) {
      // This will create a new track, so no collision detection needed
      willCreateNewTrack = true;
    }
    
    // ALWAYS perform collision detection unless creating a completely new track
    if (!willCreateNewTrack) {
      // Get items that would be on the same track as our actual target
      let sameTrackItems = [];
      
      if (isDraggingAudio && actualTargetTrackIndex < audioTrackCount) {
        // For audio items, check against items on the specific audio track
        const targetAudioTrackIndex = actualTargetTrackIndex;
        if (targetAudioTrackIndex < currentTrackAssignments.audioTracks.length) {
          sameTrackItems = currentTrackAssignments.audioTracks[targetAudioTrackIndex];
        }
      } else if (!isDraggingAudio && actualTargetTrackIndex >= audioTrackCount) {
        // For video items, check against items on the specific video track
        const targetVideoTrackIndex = actualTargetTrackIndex - audioTrackCount;
        if (targetVideoTrackIndex >= 0 && targetVideoTrackIndex < currentTrackAssignments.videoTracks.length) {
          sameTrackItems = currentTrackAssignments.videoTracks[targetVideoTrackIndex];
        }
      }
      
      const dragItemEnd = snappedTime + dragItem.duration;
      
      // Check for actual overlaps (not just touching)
      const hasOverlap = sameTrackItems.some(item => {
        const itemEnd = item.startTime + item.duration;
        // Allow touching (back-to-back) but prevent overlapping
        return (snappedTime < itemEnd && dragItemEnd > item.startTime);
      });
      
      // If there's an actual overlap, try to find a valid adjacent position
      if (hasOverlap) {
        const sortedItems = sameTrackItems.sort((a, b) => a.startTime - b.startTime);
        
        // Find the best position to place the item without overlapping
        let bestPosition = snappedTime;
        let minDistance = Infinity;
        
        // Option 1: Try placing after each existing item
        sortedItems.forEach(item => {
          const afterPosition = item.startTime + item.duration;
          const afterEnd = afterPosition + dragItem.duration;
          
          // Check if this position conflicts with any other item
          const wouldConflict = sortedItems.some(otherItem => {
            if (otherItem.id === item.id) return false;
            const otherEnd = otherItem.startTime + otherItem.duration;
            return (afterPosition < otherEnd && afterEnd > otherItem.startTime);
          });
          
          if (!wouldConflict) {
            const distance = Math.abs(afterPosition - snappedTime);
            if (distance < minDistance) {
              bestPosition = afterPosition;
              minDistance = distance;
            }
          }
        });
        
        // Option 2: Try placing before each existing item
        sortedItems.forEach(item => {
          const beforePosition = item.startTime - dragItem.duration;
          if (beforePosition >= 0) {
            const beforeEnd = beforePosition + dragItem.duration;
            
            // Check if this position conflicts with any other item
            const wouldConflict = sortedItems.some(otherItem => {
              if (otherItem.id === item.id) return false;
              const otherEnd = otherItem.startTime + otherItem.duration;
              return (beforePosition < otherEnd && beforeEnd > otherItem.startTime);
            });
            
            if (!wouldConflict) {
              const distance = Math.abs(beforePosition - snappedTime);
              if (distance < minDistance) {
                bestPosition = beforePosition;
                minDistance = distance;
              }
            }
          }
        });
        
        // Only update if we found a valid position that's reasonably close
        if (minDistance < Infinity && minDistance <= dragItem.duration * 2) {
          finalTime = bestPosition;
        } else {
          // If no good position found, don't move at all
          return;
        }
      }
    }
    
    // Only update position if it's a valid move
    if (isValidTrackType || isNewTrackArea) {
    // Update the item position
    const updatedItems = mediaItems.map(item => 
      item.id === dragItem.id 
        ? { 
            ...item, 
            startTime: finalTime,
              // Set forceTrackIndex only for valid track moves
              forceTrackIndex: targetTrackIndex >= 0 ? targetTrackIndex : undefined
          }
        : item
    );
    
    onItemsUpdate(updatedItems);
    }
  }, [isDragging, dragItem, dragOffset, scale, mediaItems, onItemsUpdate, calculateTrackAssignments, selectedItems]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragItem(null);
    setDragOffset(0);
    setDragTargetTrack(null); // Clear drag target
    // Clear multi-select drag refs
    dragStartMouseX.current = null;
    dragStartPositions.current.clear();
    // Don't automatically close context menu on mouse up
  }, []);

  // Handle timeline tracks click for deselection
  const handleTracksClick = useCallback((e) => {
    // Only deselect if clicking on the tracks area itself, not on an item
    // Also check if we're not currently dragging to avoid deselecting during drag operations
    if (!isDragging && (e.target.classList.contains('timeline-tracks') || 
        e.target.classList.contains('timeline-track'))) {
      setSelectedItems(new Set());
    }
  }, [isDragging]);

  // Handle mouse wheel for smooth timeline zooming
  const handleWheel = useCallback((e) => {
      e.preventDefault();
    
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Calculate the time position under the mouse before zoom
    const timeUnderMouse = mouseX / scale;
    
    // Calculate new scale with smooth increments
    const zoomFactor = e.deltaY > 0 ? 0.85 : 1.18; // More granular zoom steps
    const newScale = Math.max(2, Math.min(200, scale * zoomFactor)); // Wider zoom range
    
    // Calculate how much to adjust the scroll position to keep the mouse position stable
    const newMouseX = timeUnderMouse * newScale;
    const scrollDelta = newMouseX - mouseX;
    
    setScale(newScale);
    
    // Adjust scroll position to keep zoom centered on mouse (if timeline is scrollable)
    if (timelineRef.current.parentElement) {
      const container = timelineRef.current.parentElement;
      if (container.scrollLeft !== undefined) {
        container.scrollLeft += scrollDelta;
      }
    }
  }, [scale]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item: item
    });
  }, []);

  // Close context menu
  const closeContextMenu = useCallback((e) => {
    // Don't close if clicking inside the context menu
    if (e && e.target && e.target.closest('.context-menu')) {
      return;
    }
    setContextMenu(null);
  }, []);

  // Toggle track lock
  const toggleTrackLock = useCallback((itemId) => {
    setLockedTracks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
    closeContextMenu();
  }, [closeContextMenu]);

  // Delete selected items
  const deleteSelectedItems = useCallback(() => {
    const updatedItems = mediaItems.filter(item => !selectedItems.has(item.id));
    onItemsUpdate(updatedItems);
    setSelectedItems(new Set());
    closeContextMenu();
  }, [mediaItems, selectedItems, onItemsUpdate, closeContextMenu]);

  // Copy selected items
  const copySelectedItems = useCallback(() => {
    const itemsToCopy = mediaItems.filter(item => selectedItems.has(item.id));
    setCopiedItems(itemsToCopy);
    closeContextMenu();
  }, [mediaItems, selectedItems, closeContextMenu]);

  // Paste copied items with smart track placement
  const pasteItems = useCallback(() => {
    if (copiedItems.length === 0) return;
    
    const pasteTime = currentTime;
    const newItems = copiedItems.map((item, index) => ({
      ...item,
      id: Date.now() + Math.random() + index, // New unique ID
      startTime: pasteTime + (index * 0.1) // Slight offset for multiple items
    }));
    
    // Check for overlaps and adjust positions if needed
    const allItems = [...mediaItems, ...newItems];
    const finalItems = [];
    
    newItems.forEach(newItem => {
      let finalStartTime = newItem.startTime;
      let attempts = 0;
      
      // Try to find a non-overlapping position
      while (attempts < 10) {
        const hasOverlap = mediaItems.some(existingItem => {
          const newEnd = finalStartTime + newItem.duration;
          const existingEnd = existingItem.startTime + existingItem.duration;
          return !(finalStartTime >= existingEnd || newEnd <= existingItem.startTime);
        });
        
        if (!hasOverlap) break;
        
        // Move to the end of the conflicting items
        const conflictingItems = mediaItems.filter(existingItem => {
          const newEnd = finalStartTime + newItem.duration;
          const existingEnd = existingItem.startTime + existingItem.duration;
          return !(finalStartTime >= existingEnd || newEnd <= existingItem.startTime);
        });
        
        if (conflictingItems.length > 0) {
          const maxEndTime = Math.max(...conflictingItems.map(item => item.startTime + item.duration));
          finalStartTime = maxEndTime + 0.1;
        }
        
        attempts++;
      }
      
      finalItems.push({ ...newItem, startTime: finalStartTime });
    });
    
    onItemsUpdate([...mediaItems, ...finalItems]);
    setSelectedItems(new Set(finalItems.map(item => item.id)));
    closeContextMenu();
  }, [copiedItems, currentTime, mediaItems, onItemsUpdate, closeContextMenu]);

  // Duplicate selected items with smart placement
  const duplicateSelectedItems = useCallback(() => {
    const itemsToDuplicate = mediaItems.filter(item => selectedItems.has(item.id));
    const newItems = itemsToDuplicate.map((item, index) => {
      // Try to place right after the original item
      let newStartTime = item.startTime + item.duration + 0.1;
      
      // Check for overlaps and adjust if needed
      const hasOverlap = mediaItems.some(existingItem => {
        if (existingItem.id === item.id) return false; // Skip the original item
        const newEnd = newStartTime + item.duration;
        const existingEnd = existingItem.startTime + existingItem.duration;
        return !(newStartTime >= existingEnd || newEnd <= existingItem.startTime);
      });
      
      if (hasOverlap) {
        // Find the latest end time and place after it
        const endTimes = mediaItems.map(mediaItem => mediaItem.startTime + mediaItem.duration);
        newStartTime = Math.max(...endTimes) + 0.1;
      }
      
      return {
        ...item,
        id: Date.now() + Math.random() + index,
        startTime: newStartTime
      };
    });
    
    onItemsUpdate([...mediaItems, ...newItems]);
    setSelectedItems(new Set(newItems.map(item => item.id)));
    closeContextMenu();
  }, [mediaItems, selectedItems, onItemsUpdate, closeContextMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItems.size > 0) {
          deleteSelectedItems();
        }
      } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        if (selectedItems.size > 0) {
          copySelectedItems();
        }
      } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        pasteItems();
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedItems.size > 0) {
          duplicateSelectedItems();
        }
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedItems(new Set(mediaItems.map(item => item.id)));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, deleteSelectedItems, copySelectedItems, pasteItems, duplicateSelectedItems, mediaItems]);

  // Mouse event listeners
  useEffect(() => {
    const handleDocumentClick = (e) => {
      // Only close context menu if clicking outside of it
      if (contextMenu && !e.target.closest('.context-menu')) {
        closeContextMenu(e);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Add click listener only if context menu is open
    if (contextMenu) {
      document.addEventListener('click', handleDocumentClick);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [handleMouseMove, handleMouseUp, contextMenu, closeContextMenu]);

  // Get appropriate icon for media item
  const getMediaIcon = useCallback((item) => {
    if (item.type === 'video') {
      return '🎬'; // Video camera for regular videos
    } else if (item.type === 'image') {
      return (item.subtype === 'gif' || item.subtype === 'sticker') ? '🎭' : '🖼️'; // Animated mask for GIFs and stickers, frame for static images
    }
    return '📄'; // Default fallback
  }, []);

  // Get item color based on type
  const getItemColor = useCallback((item) => {
    if (item.type === 'video') {
      return '#8b5cf6'; // Purple for videos
    } else if (item.type === 'image') {
      return (item.subtype === 'gif' || item.subtype === 'sticker') ? 
             '#8b5cf6' : // Purple for animated images
             '#10b981'; // Green for static images
    } else if (item.type === 'audio') {
      return '#06b6d4'; // Cyan for audio to distinguish from video
    }
    return '#8b5cf6'; // Default purple
  }, []);

  return (
    <div className="timeline-container" style={{
      border: '1px solid #333',
      borderTop: 'none'
    }}>
      <div className="timeline-header" style={{
        background: '#2a2a2a',
        padding: '8px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '40px'
      }}>
        <span style={{ fontSize: '13px', fontWeight: '500', color: '#fff' }}>Timeline</span>
        
        <button 
          onClick={onPlayPause}
          className={`timeline-play-button ${isPlaying ? 'playing' : ''}`}
          style={{
            background: '#444',
            color: 'white',
            border: 'none',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'background 0.2s ease'
          }}
          onMouseEnter={(e) => e.target.style.background = '#555'}
          onMouseLeave={(e) => e.target.style.background = '#444'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#999' }}>
            Selected: {selectedItems.size} | Copied: {copiedItems.length}
          </span>
          <span style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace' }}>
            {Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(1).padStart(4, '0')} / {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
          </span>
        </div>
      </div>
      
      <div 
        ref={timelineRef}
        className="timeline-ruler" 
        onClick={handleTimelineClick}
        onWheel={handleWheel}
        onDrop={handleTimelineDrop}
        onDragOver={handleTimelineDragOver}
        style={{ 
          position: 'relative', 
          height: '32px', 
          background: '#252525', 
          cursor: 'pointer',
          borderBottom: '1px solid #333'
        }}
      >
        {generateTimeMarkers()}
        <div 
          className="timeline-playhead"
          style={{ 
            position: 'absolute',
            left: `${currentTime * scale}px`,
            top: '0',
            width: '2px',
            height: '100%',
            background: '#ff4444',
            pointerEvents: 'none',
            zIndex: 15
          }}
        >
          {/* Playhead handle */}
        <div style={{
          position: 'absolute',
            top: '-1px',
            left: '-3px',
            width: '8px',
            height: '6px',
            background: '#ff4444',
            borderRadius: '1px'
          }} />
        </div>
      </div>
      
      <div className="timeline-tracks" style={{ 
        minHeight: '200px', 
        background: '#1e1e1e', 
        position: 'relative'
      }}
        onDrop={handleTimelineDrop}
        onDragOver={handleTimelineDragOver}
        onClick={handleTracksClick}
      >
        {/* Audio Tracks */}
        {trackAssignments.audioTracks.map((track, trackIndex) => (
          <div
            key={`audio-${trackIndex}`}
            className={`timeline-track ${lockedTracks.has(`audio-${trackIndex}`) ? 'locked' : ''}`}
            style={{
              height: '50px',
              borderBottom: '1px solid #2a2a2a',
              position: 'relative',
              background: dragTargetTrack?.index === trackIndex && dragTargetTrack?.canPlaceHere ? 
                         'rgba(139, 92, 246, 0.1)' : 
                         '#1e1e1e'
            }}
          >
            {/* Track label */}
            <div style={{
              position: 'absolute',
              left: '8px',
              top: '6px',
              fontSize: '10px',
              color: '#888',
              pointerEvents: 'none',
              zIndex: 1,
              fontWeight: '500'
            }}>
              🎵 Audio {trackIndex + 1} {lockedTracks.has(`audio-${trackIndex}`) && '🔒'}
            </div>

            {/* Track items */}
            {track.map(item => {
              const left = item.startTime * scale;
              const width = item.duration * scale;
              
              return (
                <div
                  key={item.id}
                  className={`timeline-item ${selectedItems.has(item.id) ? 'selected' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${left}px`,
                    top: '18px',
                    width: `${width}px`,
                    height: '28px',
                    background: selectedItems.has(item.id) ? 
                               '#8b5cf6' : 
                               '#06b6d4',
                    border: selectedItems.has(item.id) ? 
                           '2px solid #a855f7' : 
                           '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    fontSize: '10px',
                    color: '#fff',
                    userSelect: 'none',
                    boxShadow: selectedItems.has(item.id) ? 
                              '0 2px 4px rgba(139, 92, 246, 0.3)' : 
                              '0 1px 2px rgba(0,0,0,0.2)'
                  }}
                  onMouseDown={(e) => handleItemMouseDown(e, item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    fontWeight: '500'
                  }}>
                    🎵 {item.name}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        
        {/* Video Tracks - Always show at least one */}
        {Math.max(1, trackAssignments.videoTracks.length) && Array.from({ length: Math.max(1, trackAssignments.videoTracks.length) }, (_, trackIndex) => {
          const track = trackAssignments.videoTracks[trackIndex] || [];
          return (
          <div
            key={`video-${trackIndex}`}
            className={`timeline-track ${lockedTracks.has(`video-${trackIndex}`) ? 'locked' : ''}`}
            style={{
                height: '50px',
                borderBottom: '1px solid #2a2a2a',
              position: 'relative',
                background: dragTargetTrack?.index === (trackAssignments.audioTracks.length + trackIndex) && 
                           dragTargetTrack?.canPlaceHere ? 
                           'rgba(139, 92, 246, 0.1)' : 
                           '#1e1e1e'
            }}
          >
            {/* Track label */}
            <div style={{
              position: 'absolute',
                left: '8px',
                top: '6px',
                fontSize: '10px',
                color: '#888',
              pointerEvents: 'none',
                zIndex: 1,
                fontWeight: '500'
            }}>
                🎬 Video {trackIndex + 1} {lockedTracks.has(`video-${trackIndex}`) && '🔒'}
            </div>

            {/* Track items */}
            {track.map(item => {
              const left = item.startTime * scale;
              const width = item.duration * scale;
              
              return (
                <div
                  key={item.id}
                  className={`timeline-item ${selectedItems.has(item.id) ? 'selected' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${left}px`,
                      top: '18px',
                    width: `${width}px`,
                      height: '28px',
                      background: selectedItems.has(item.id) ? 
                                 '#8b5cf6' : 
                                 getItemColor(item),
                      border: selectedItems.has(item.id) ? 
                             '2px solid #a855f7' : 
                             '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                      padding: '0 6px',
                    cursor: 'pointer',
                    overflow: 'hidden',
                      fontSize: '10px',
                    color: '#fff',
                      userSelect: 'none',
                      boxShadow: selectedItems.has(item.id) ? 
                                '0 2px 4px rgba(139, 92, 246, 0.3)' : 
                                '0 1px 2px rgba(0,0,0,0.2)'
                  }}
                  onMouseDown={(e) => handleItemMouseDown(e, item)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                    onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                      fontWeight: '500'
                  }}>
                    {item.name}
                  </span>
                </div>
              );
            })}
          </div>
          );
        })}

        {/* New Track Drop Zone - only show when dragging */}
        {isDragging && (
          <div
            style={{
              height: '50px',
              borderBottom: '2px dashed #444',
              position: 'relative',
              background: dragTargetTrack?.isNewTrack ? 
                         'rgba(139, 92, 246, 0.1)' : 
                         '#1e1e1e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
              fontSize: '11px',
              fontStyle: 'italic',
              fontWeight: '500'
            }}
          >
            {dragTargetTrack?.isNewTrack ? (
              <span style={{ color: '#8b5cf6' }}>
                ✨ Drop here to create new track
              </span>
            ) : (
              <span>
                Drop here to create new track
              </span>
            )}
          </div>
        )}
        
        {/* Calculate total height needed */}
        <div style={{ 
          height: `${Math.max(1, (trackAssignments.audioTracks.length + Math.max(1, trackAssignments.videoTracks.length))) * 50 + 20}px` 
        }} />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '6px 0',
            minWidth: '160px',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={() => toggleTrackLock(contextMenu.item.id)}
          >
            {lockedTracks.has(contextMenu.item.id) ? '🔓 Unlock Track' : '🔒 Lock Track'}
          </div>
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={copySelectedItems}
          >
            📋 Copy (Ctrl+C)
          </div>
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={duplicateSelectedItems}
          >
            📋 Duplicate (Ctrl+D)
          </div>
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={pasteItems}
            disabled={copiedItems.length === 0}
          >
            📋 Paste (Ctrl+V) {copiedItems.length > 0 ? `(${copiedItems.length})` : ''}
          </div>
          <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #444' }} />
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#ff6b6b', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={deleteSelectedItems}
          >
            🗑️ Delete (Del)
          </div>
        </div>
      )}

      {/* Help text */}
      <div style={{ 
        padding: '8px 16px', 
        fontSize: '10px', 
        color: '#666',
        borderTop: '1px solid #2a2a2a',
        background: '#1a1a1a',
        fontWeight: '400'
      }}>
        💡 Shift+Click: Multi-select | Scroll: Zoom timeline | Right-click: Context menu | Drag: Move items
      </div>
    </div>
  );
};

export default Timeline;