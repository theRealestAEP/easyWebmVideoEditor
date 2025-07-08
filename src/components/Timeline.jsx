import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

// Small tolerance for floating-point precision in collision detection
// This allows items to be placed truly back-to-back with 0 gap
const COLLISION_TOLERANCE = 0.05; // 50ms tolerance to account for 0.1s snapping grid


const SNAP_DISTANCE = 0.2; // 200ms - snap to adjacent items when within this distance

const Timeline = forwardRef(({ 
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
}, ref) => {
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
  const dragStartMouseY = useRef(null); // Store mouse Y when drag starts
  const dragStartTrackIndex = useRef(null); // Store track index when drag starts

  // Drag-to-select state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState(null);
  const selectStartPos = useRef({ x: 0, y: 0 });

  // Scrubbing state for timeline ruler
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [rulerMouseDown, setRulerMouseDown] = useState(false);
  const rulerMouseDownPos = useRef({ x: 0, y: 0 });

  // Smart snapping function that snaps to adjacent items
  const getSmartSnappedTime = useCallback((rawTime, draggedItemId, trackItems) => {
    // First, apply grid snapping
    const gridSnappedTime = Math.round(rawTime * 10) / 10;
    
    // Find potential snap targets from other items on the same track
    const otherItems = trackItems.filter(item => item.id !== draggedItemId);
    let bestSnapTime = gridSnappedTime;
    let minSnapDistance = Infinity;
    
    // Check snapping to start and end times of other items
    otherItems.forEach(item => {
      const itemStartTime = item.startTime;
      const itemEndTime = item.startTime + item.duration;
      
      // Check snapping to item's end time (for back-to-back placement)
      const distanceToEnd = Math.abs(rawTime - itemEndTime);
      if (distanceToEnd <= SNAP_DISTANCE && distanceToEnd < minSnapDistance) {
        bestSnapTime = itemEndTime;
        minSnapDistance = distanceToEnd;
      }
      
      // Check snapping to item's start time
      const distanceToStart = Math.abs(rawTime - itemStartTime);
      if (distanceToStart <= SNAP_DISTANCE && distanceToStart < minSnapDistance) {
        bestSnapTime = itemStartTime;
        minSnapDistance = distanceToStart;
      }
    });
    
    // Also check snapping to time 0
    const distanceToZero = Math.abs(rawTime - 0);
    if (distanceToZero <= SNAP_DISTANCE && distanceToZero < minSnapDistance) {
      bestSnapTime = 0;
      minSnapDistance = distanceToZero;
    }
    
    return bestSnapTime;
  }, []);

  // Calculate which track each item should be on (avoiding overlaps) - MOVED EARLY
  const calculateTrackAssignments = useCallback((items) => {
    // Separate audio and video items
    const audioItems = items.filter(item => item.type === 'audio');
    const videoItems = items.filter(item => item.type !== 'audio');
    
    const audioTracks = [];
    const videoTracks = [];
    
    // Process video items FIRST (since they appear first in UI)
    const sortedVideoItems = [...videoItems].sort((a, b) => a.startTime - b.startTime);
    sortedVideoItems.forEach(item => {
      const itemEnd = item.startTime + item.duration;
      
      // Handle forced track assignments for video items
      if (item.forceTrackIndex !== undefined) {
        const targetTrack = item.forceTrackIndex;
        
        // For video items, forceTrackIndex directly maps to video track index
        // (since video tracks are first in the UI)
        if (targetTrack >= 0) {
          // Ensure we have enough video tracks
          while (videoTracks.length <= targetTrack) {
            videoTracks.push([]);
          }
          
          videoTracks[targetTrack].push({ ...item, trackIndex: targetTrack, trackType: 'video', forceTrackIndex: undefined });
          return;
        }
      }
      
      // Find the first video track where this item fits without overlap
      let assignedTrack = -1;
      for (let trackIndex = 0; trackIndex < videoTracks.length; trackIndex++) {
        const track = videoTracks[trackIndex];
        const hasOverlap = track.some(trackItem => {
          const trackItemEnd = trackItem.startTime + trackItem.duration;
          return !(item.startTime >= trackItemEnd - COLLISION_TOLERANCE || itemEnd <= trackItem.startTime + COLLISION_TOLERANCE);
        });
        
        if (!hasOverlap) {
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
    
    // Process audio items SECOND (since they appear after video tracks in UI)
    const sortedAudioItems = [...audioItems].sort((a, b) => a.startTime - b.startTime);
    sortedAudioItems.forEach(item => {
      const itemEnd = item.startTime + item.duration;
      
      // Handle forced track assignments for audio items
      if (item.forceTrackIndex !== undefined) {
        const targetTrack = item.forceTrackIndex;
        
        // For audio items, forceTrackIndex needs to be converted to audio track index
        // by subtracting the number of video tracks (since video tracks come first in UI)
        const videoTrackCount = Math.max(1, videoTracks.length); // Always show at least 1 video track
        const audioTrackIndex = targetTrack - videoTrackCount;
        
        // Only assign if targeting audio track area (after video tracks)
        if (audioTrackIndex >= 0) {
          // Ensure we have enough audio tracks
          while (audioTracks.length <= audioTrackIndex) {
            audioTracks.push([]);
          }
          
          audioTracks[audioTrackIndex].push({ ...item, trackIndex: audioTrackIndex, trackType: 'audio', forceTrackIndex: undefined });
          return;
        }
      }
      
      // Find the first audio track where this item fits without overlap
      let assignedTrack = -1;
      for (let trackIndex = 0; trackIndex < audioTracks.length; trackIndex++) {
        const track = audioTracks[trackIndex];
        const hasOverlap = track.some(trackItem => {
          const trackItemEnd = trackItem.startTime + trackItem.duration;
          return !(item.startTime >= trackItemEnd - COLLISION_TOLERANCE || itemEnd <= trackItem.startTime + COLLISION_TOLERANCE);
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
    
    // Clean up empty tracks and reorganize
    const cleanedVideoTracks = videoTracks.filter(track => track.length > 0);
    const cleanedAudioTracks = audioTracks.filter(track => track.length > 0);
    
    // Function to check for overlaps within a track
    const checkTrackOverlaps = (track) => {
      for (let i = 0; i < track.length; i++) {
        for (let j = i + 1; j < track.length; j++) {
          const item1 = track[i];
          const item2 = track[j];
          const item1End = item1.startTime + item1.duration;
          const item2End = item2.startTime + item2.duration;
          
          // Check if items overlap (with tolerance for back-to-back placement)
          if (!(item1.startTime >= item2End - COLLISION_TOLERANCE || item1End <= item2.startTime + COLLISION_TOLERANCE)) {
            return { hasOverlap: true, item1, item2 };
          }
        }
      }
      return { hasOverlap: false };
    };
    
    // Function to resolve overlaps by moving items to new tracks
    const resolveOverlaps = (tracks, trackType) => {
      let resolvedTracks = [...tracks];
      let changed = true;
      
      while (changed) {
        changed = false;
        
        for (let trackIndex = 0; trackIndex < resolvedTracks.length; trackIndex++) {
          const track = resolvedTracks[trackIndex];
          const overlapResult = checkTrackOverlaps(track);
          
          if (overlapResult.hasOverlap) {
            // Move the second overlapping item to a new track
            const itemToMove = overlapResult.item2;
            
            // Remove from current track
            resolvedTracks[trackIndex] = track.filter(item => item.id !== itemToMove.id);
            
            // Find an existing track where it fits, or create a new one
            let newTrackIndex = -1;
            for (let i = 0; i < resolvedTracks.length; i++) {
              const candidateTrack = resolvedTracks[i];
              const itemEnd = itemToMove.startTime + itemToMove.duration;
              
              const wouldOverlap = candidateTrack.some(existingItem => {
                const existingEnd = existingItem.startTime + existingItem.duration;
                return !(itemToMove.startTime >= existingEnd - COLLISION_TOLERANCE || itemEnd <= existingItem.startTime + COLLISION_TOLERANCE);
              });
              
              if (!wouldOverlap) {
                newTrackIndex = i;
                break;
              }
            }
            
            if (newTrackIndex === -1) {
              // Create new track
              newTrackIndex = resolvedTracks.length;
              resolvedTracks.push([]);
            }
            
            // Add item to new track
            resolvedTracks[newTrackIndex].push(itemToMove);
            
            changed = true;
            break; // Restart the checking process
          }
        }
      }
      
      return resolvedTracks;
    };
    
    // Resolve overlaps in both video and audio tracks
    const finalVideoTracks = resolveOverlaps(cleanedVideoTracks, 'video');
    const finalAudioTracks = resolveOverlaps(cleanedAudioTracks, 'audio');
    
    // Update track indices after cleanup and overlap resolution
    finalVideoTracks.forEach((track, trackIndex) => {
      track.forEach(item => {
        item.trackIndex = trackIndex;
        // Clear forceTrackIndex after assignment
        delete item.forceTrackIndex;
      });
    });
    
    finalAudioTracks.forEach((track, trackIndex) => {
      track.forEach(item => {
        item.trackIndex = trackIndex;
        // Clear forceTrackIndex after assignment
        delete item.forceTrackIndex;
      });
    });
    
    console.log('Track assignments - Video tracks:', finalVideoTracks.length, 'Audio tracks:', finalAudioTracks.length);
    
    return { videoTracks: finalVideoTracks, audioTracks: finalAudioTracks };
  }, []);

  // Get track assignments for current media items
  const trackAssignments = calculateTrackAssignments(mediaItems);
  
  // Expose audioElements via ref
  useImperativeHandle(ref, () => ({
    getAudioElements: () => audioElements.current
  }), []);

  // Debug logging
  console.log('Timeline rendering - trackAssignments:', trackAssignments, 'mediaItems:', mediaItems.length);

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
    // Only include dedicated audio items - video items are PNG sequences and shouldn't play audio
    const audioItems = mediaItems.filter(item => item.type === 'audio');
    const allAudioSources = [...audioItems];
    
    console.log('Timeline audio management:', {
      audioItems: audioItems.length,
      totalAudioSources: allAudioSources.length
    });
    
    // Create audio elements for new audio sources (both audio files and video files)
    allAudioSources.forEach(item => {
      if (!audioElements.current.has(item.id)) {
        let audioUrl;
        
        // Prioritize original File object for uploaded MP4s to preserve audio
        if (item.file && item.file instanceof File) {
          audioUrl = URL.createObjectURL(item.file);
          console.log('Creating audio element from File object for:', item.name, 'type:', item.type);
        } else if (item.url) {
          audioUrl = item.url;
          console.log('Creating audio element from URL for:', item.name, 'type:', item.type);
        } else {
          console.warn('No valid audio source found for:', item.name);
          return;
        }
        
        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous'; // Enable CORS for Web Audio API
        
        // For video files, we're extracting the audio track for timeline playback
        if (item.type === 'video') {
          console.log('Preserving audio track from video file:', item.name);
          
          // Handle MP4 audio track loading
          audio.addEventListener('loadedmetadata', () => {
            console.log('MP4 audio metadata loaded:', {
              name: item.name,
              duration: audio.duration,
              hasAudioTrack: audio.duration > 0
            });
          });
          
          // Handle potential audio loading issues
          audio.addEventListener('error', (e) => {
            console.warn('Audio loading failed for video file:', item.name, e);
          });
        }
        
        audioElements.current.set(item.id, audio);
      }
    });

    // Remove audio elements for deleted items
    const currentAudioIds = new Set(allAudioSources.map(item => item.id));
    for (const [id, audio] of audioElements.current.entries()) {
      if (!currentAudioIds.has(id)) {
        audio.pause();
        // Clean up blob URL if it was created from a File object
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
        audioElements.current.delete(id);
        console.log('Removed audio element for deleted item:', id);
      }
    }

    // Update audio playback based on timeline state
    allAudioSources.forEach(item => {
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
          console.log('Starting audio playback for:', item.name, 'type:', item.type, 'at time:', audioTime.toFixed(2));
          audio.play().catch(error => {
            console.warn('Audio play failed for', item.name, ':', error);
          });
        }
      } else {
        if (!audio.paused) {
          console.log('Pausing audio for:', item.name, 'type:', item.type);
          audio.pause();
        }
      }
    });

    return () => {
      // Cleanup audio elements when component unmounts
      for (const audio of audioElements.current.values()) {
        audio.pause();
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
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
        // For timeline ruler, show only whole seconds for cleaner display
        const wholeSeconds = Math.floor(time);
        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        
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
            {minutes}:{seconds.toString().padStart(2, '0')}
          </div>
        );
      }
    }
    
    return markers;
  }, [duration, scale]);

  // Handle timeline click for scrubbing
  const handleTimelineClick = useCallback((e) => {
    if (isDragging || isSelecting || isScrubbing) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(duration, clickX / scale));
    onTimeUpdate(newTime);
    
    // Deselect all items when clicking on empty timeline
    setSelectedItems(new Set());
  }, [scale, duration, onTimeUpdate, isDragging, isSelecting, isScrubbing]);

  // Handle mouse down for scrubbing in timeline ruler
  const handleRulerMouseDown = useCallback((e) => {
    // Don't start scrubbing if already dragging items
    if (isDragging) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const newTime = Math.max(0, Math.min(duration, clickX / scale));
    onTimeUpdate(newTime);
    
    // Track that mouse is down in ruler and store position
    setRulerMouseDown(true);
    rulerMouseDownPos.current = { x: e.clientX, y: e.clientY };
    
    // Also initialize selection in case user drags
    selectStartPos.current = { x: clickX, y: clickY };
    
    // Deselect all items when starting to interact with ruler
    setSelectedItems(new Set());

    // Prevent default to avoid text selection
    e.preventDefault();
  }, [scale, duration, onTimeUpdate, isDragging]);

  // Handle mouse down for drag-to-select (works in both ruler and tracks)
  const handleTimelineMouseDown = useCallback((e) => {
    // Only start selection if not clicking on an item and not already dragging
    if (isDragging || e.target.classList.contains('timeline-item') || 
        e.target.closest('.timeline-item')) {
      return;
    }

    const rect = timelineRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    selectStartPos.current = { x: startX, y: startY };
    setIsSelecting(true);
    setSelectionBox({ x: startX, y: startY, width: 0, height: 0 });

    // Prevent default to avoid text selection
    e.preventDefault();
  }, [isDragging]);

  // Handle mouse down for drag-to-select in tracks area
  const handleTracksMouseDown = useCallback((e) => {
    // Only handle left-click (button 0) for selection
    // Right-click (button 2) should be handled by onContextMenu on timeline items
    if (e.button !== 0) return;
    
    // Only start selection if not clicking on an item and not already dragging
    if (isDragging || e.target.classList.contains('timeline-item') || 
        e.target.closest('.timeline-item')) {
      return;
    }

    // Get the timeline container rect (not just tracks)
    const timelineRect = timelineRef.current.getBoundingClientRect();
    const tracksRect = e.currentTarget.getBoundingClientRect();
    
    // Calculate position relative to the timeline container
    const startX = e.clientX - timelineRect.left;
    const startY = e.clientY - timelineRect.top;

    selectStartPos.current = { x: startX, y: startY };
    setIsSelecting(true);
    setSelectionBox({ x: startX, y: startY, width: 0, height: 0 });

    // Prevent default to avoid text selection
    e.preventDefault();
  }, [isDragging]);

  // Handle mouse move for drag-to-select (updated to work from anywhere)
  const handleTimelineMouseMove = useCallback((e) => {
    if (!isSelecting) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const startX = selectStartPos.current.x;
    const startY = selectStartPos.current.y;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    setSelectionBox({ x: left, y: top, width, height });

    // Find items within selection box
    const selectedIds = new Set();
    const timelineHeaderHeight = 72; // Header (40px) + Ruler (32px) = 72px total
    const trackHeight = 50;
    const trackGap = 20; // Gap between video and audio tracks

    // Calculate time range
    const leftTime = left / scale;
    const rightTime = (left + width) / scale;

    // Calculate track assignments inside this function to avoid initialization issues
    const currentTrackAssignments = calculateTrackAssignments(mediaItems);

    // Check video tracks FIRST (they're rendered at the top)
    currentTrackAssignments.videoTracks.forEach((track, trackIndex) => {
      const trackTop = timelineHeaderHeight + (trackIndex * trackHeight);
      const trackBottom = trackTop + trackHeight;

      if (top <= trackBottom && (top + height) >= trackTop) {
        track.forEach(item => {
          const itemEnd = item.startTime + item.duration;
          if (item.startTime <= rightTime && itemEnd >= leftTime) {
            selectedIds.add(item.id);
          }
        });
      }
    });

    // Check audio tracks AFTER video tracks + gap
    currentTrackAssignments.audioTracks.forEach((track, trackIndex) => {
      const videoTracksHeight = Math.max(1, currentTrackAssignments.videoTracks.length) * trackHeight;
      const actualGapHeight = currentTrackAssignments.audioTracks.length > 0 ? trackGap : 0;
      const trackTop = timelineHeaderHeight + videoTracksHeight + actualGapHeight + (trackIndex * trackHeight);
      const trackBottom = trackTop + trackHeight;

      if (top <= trackBottom && (top + height) >= trackTop) {
        track.forEach(item => {
          const itemEnd = item.startTime + item.duration;
          if (item.startTime <= rightTime && itemEnd >= leftTime) {
            selectedIds.add(item.id);
          }
        });
      }
    });

    setSelectedItems(selectedIds);
  }, [isSelecting, scale, calculateTrackAssignments, mediaItems]);

  // Handle mouse up for drag-to-select
  const handleTimelineMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      setSelectionBox(null);
    }
  }, [isSelecting]);

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
      
      // Calculate which track to drop into based on item type and drop position
      const timelineHeaderHeight = 72; // Header (40px) + Ruler (32px) = 72px total
      const trackHeight = 50; // Match actual track height
      const trackGap = 20; // Gap between video and audio sections
      const mouseYInTracks = dropY - timelineHeaderHeight;
      
      let targetTrackIndex = undefined;
      
      // Determine target track based on item type
      if (sourceItem.type === 'audio') {
        // For audio items, calculate position within audio section
        const currentAssignments = calculateTrackAssignments(mediaItems);
        const videoTrackCount = Math.max(1, currentAssignments.videoTracks.length);
        const audioTrackCount = currentAssignments.audioTracks.length;
        
        const actualGapHeight = audioTrackCount > 0 ? trackGap : 0;
        const audioSectionStartY = (videoTrackCount * trackHeight) + actualGapHeight;
        const audioMouseY = mouseYInTracks - audioSectionStartY;
        
        if (audioMouseY >= 0) {
          // Dropped in audio section
          const audioTrackIndex = Math.floor(audioMouseY / trackHeight);
          targetTrackIndex = videoTrackCount + audioTrackIndex; // Absolute UI position
        }
        // If dropped above audio section, don't set targetTrackIndex (will use auto-assignment)
      } else {
        // For video items, calculate position within video section
        const videoTrackIndex = Math.floor(mouseYInTracks / trackHeight);
        
        // Check if dropped in video section (not in audio section)
        const currentAssignments = calculateTrackAssignments(mediaItems);
        const videoTrackCount = Math.max(1, currentAssignments.videoTracks.length);
        const audioTrackCount = currentAssignments.audioTracks.length;
        
        if (audioTrackCount > 0) {
          const videoSectionEndY = videoTrackCount * trackHeight;
          const audioSectionStartY = videoSectionEndY + trackGap;
          
          if (mouseYInTracks < audioSectionStartY && videoTrackIndex >= 0) {
            targetTrackIndex = videoTrackIndex; // Direct video track index
          }
        } else if (videoTrackIndex >= 0) {
          targetTrackIndex = videoTrackIndex; // Direct video track index
        }
        // If dropped in audio section, don't set targetTrackIndex (will use auto-assignment)
      }
      
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

  // Handle mouse down on timeline items
  const handleItemMouseDown = useCallback((e, item) => {
    // Only handle left-click (button 0) for dragging
    // Right-click (button 2) should be handled by onContextMenu
    if (e.button !== 0) return;
    
    if (lockedTracks.has(item.id)) return; // Don't allow dragging locked items
    
    e.stopPropagation();
    
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const itemLeft = item.startTime * scale;
    
    setIsDragging(true);
    setDragItem(item);
    setDragOffset(mouseX - itemLeft);
    
    // Store initial drag position for track change detection
    dragStartMouseY.current = mouseY;
    
    // Find and store the current track index of the dragged item
    const allTrackAssignments = calculateTrackAssignments(mediaItems);
    let currentTrackIndex = -1;
    
    // Check video tracks first
    allTrackAssignments.videoTracks.forEach((track, trackIndex) => {
      if (track.some(trackItem => trackItem.id === item.id)) {
        currentTrackIndex = trackIndex;
      }
    });
    
    // If not found in video tracks, check audio tracks
    if (currentTrackIndex === -1) {
      const videoTrackCount = Math.max(1, allTrackAssignments.videoTracks.length);
      allTrackAssignments.audioTracks.forEach((track, trackIndex) => {
        if (track.some(trackItem => trackItem.id === item.id)) {
          currentTrackIndex = videoTrackCount + trackIndex; // Absolute UI position
        }
      });
    }
    
    dragStartTrackIndex.current = currentTrackIndex;
    
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
  }, [scale, lockedTracks, mediaItems, calculateTrackAssignments]);

  // Handle mouse move for dragging with overlap prevention and track creation
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !dragItem) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check if we're doing multi-select drag
    const isMultiSelectDrag = selectedItems.has(dragItem.id) && selectedItems.size > 1;
    
    if (isMultiSelectDrag) {
      // Multi-select drag logic
      const selectedItemsList = mediaItems.filter(item => selectedItems.has(item.id));
      
      if (!dragStartMouseX.current) {
        dragStartMouseX.current = mouseX;
        dragStartPositions.current = new Map();
        selectedItemsList.forEach(item => {
          dragStartPositions.current.set(item.id, item.startTime);
        });
      }
      
      const mouseDelta = mouseX - dragStartMouseX.current;
      const timeDelta = mouseDelta / scale;
      
      // Don't allow any selected item to go negative
      if (selectedItemsList.some(item => {
        const originalTime = dragStartPositions.current.get(item.id);
        return originalTime + timeDelta < 0;
      })) {
        return;
      }
      
      // For multi-select, check collision on each item's current track
      const allTrackAssignments = calculateTrackAssignments(mediaItems);
      
      const wouldCollide = selectedItemsList.some(selectedItem => {
        const originalTime = dragStartPositions.current.get(selectedItem.id);
        const newItemTime = originalTime + timeDelta;
        const newItemEnd = newItemTime + selectedItem.duration;
        
        // Find what track this selected item is currently on
        let selectedTrackIndex = -1;
        let selectedTrackType = '';
        
        allTrackAssignments.videoTracks.forEach((track, trackIndex) => {
          if (track.some(item => item.id === selectedItem.id)) {
            selectedTrackIndex = trackIndex;
            selectedTrackType = 'video';
          }
        });
        
        if (selectedTrackIndex === -1) {
          allTrackAssignments.audioTracks.forEach((track, trackIndex) => {
            if (track.some(item => item.id === selectedItem.id)) {
              selectedTrackIndex = trackIndex;
              selectedTrackType = 'audio';
            }
          });
        }
        
        // Get items on the same track, excluding selected items
        let sameTrackItems = [];
        if (selectedTrackType === 'video') {
          sameTrackItems = allTrackAssignments.videoTracks[selectedTrackIndex] || [];
        } else if (selectedTrackType === 'audio') {
          sameTrackItems = allTrackAssignments.audioTracks[selectedTrackIndex] || [];
        }
        
        // Filter out all selected items from collision check
        sameTrackItems = sameTrackItems.filter(item => !selectedItems.has(item.id));
        
        // Check collision with non-selected items on same track
        return sameTrackItems.some(item => {
          const itemEnd = item.startTime + item.duration;
          return (newItemTime < itemEnd - COLLISION_TOLERANCE && newItemEnd > item.startTime + COLLISION_TOLERANCE);
        });
      });
      
      if (wouldCollide) {
        return;
      }
      
      // FIXED: Maintain relative positioning for multi-select drag
      // Find the earliest item to use as anchor for grid snapping
      const sortedSelectedItems = selectedItemsList.sort((a, b) => {
        const aOriginal = dragStartPositions.current.get(a.id);
        const bOriginal = dragStartPositions.current.get(b.id);
        return aOriginal - bOriginal;
      });
      
      const anchorItem = sortedSelectedItems[0];
      const anchorOriginalTime = dragStartPositions.current.get(anchorItem.id);
      const anchorNewTime = Math.max(0, anchorOriginalTime + timeDelta);
      const anchorSnappedTime = Math.round(anchorNewTime * 10) / 10; // Grid snap the anchor
      const actualTimeDelta = anchorSnappedTime - anchorOriginalTime; // Calculate actual delta after snapping
      
      // Move all selected items using the same actual delta to preserve relative positioning
      const updatedItems = mediaItems.map(item => {
        if (!selectedItems.has(item.id)) {
          return item;
        }
        
        const originalTime = dragStartPositions.current.get(item.id);
        const newItemTime = Math.max(0, originalTime + actualTimeDelta);
        return {
          ...item,
          startTime: newItemTime // No additional snapping - preserves back-to-back positioning
        };
      });
      
      onItemsUpdate(updatedItems);
      return;
    }
    
    // Single item drag - IMPROVED TRACK CHANGING WITH THRESHOLD
    const newStartTime = Math.max(0, (mouseX - dragOffset) / scale);
    const snappedTime = Math.round(newStartTime * 10) / 10;
    
    // Check if user has moved significantly in Y direction to allow track changes
    const TRACK_CHANGE_THRESHOLD = 25; // pixels
    const yDelta = Math.abs(mouseY - (dragStartMouseY.current || mouseY));
    const shouldAllowTrackChange = yDelta >= TRACK_CHANGE_THRESHOLD;
    
    // Calculate which track the mouse is over
    const timelineHeaderHeight = 72; // Header (40px) + Ruler (32px) = 72px total
    const trackHeight = 50; // Match the actual track height
    const trackGap = 20; // Visual gap between video and audio sections
    const mouseYInTracks = mouseY - timelineHeaderHeight;
    
    // Find what track the dragged item is currently on using FULL media items
    const allTrackAssignments = calculateTrackAssignments(mediaItems);
    let draggedItemTrackIndex = -1;
    let draggedItemTrackType = '';
    
    // Find the dragged item's current track
    allTrackAssignments.videoTracks.forEach((track, trackIndex) => {
      if (track.some(item => item.id === dragItem.id)) {
        draggedItemTrackIndex = trackIndex;
        draggedItemTrackType = 'video';
      }
    });
    
    if (draggedItemTrackIndex === -1) {
      allTrackAssignments.audioTracks.forEach((track, trackIndex) => {
        if (track.some(item => item.id === dragItem.id)) {
          draggedItemTrackIndex = trackIndex;
          draggedItemTrackType = 'audio';
        }
      });
    }
    
    // If we can't find the track, allow the move on current track
    if (draggedItemTrackIndex === -1) {
      console.warn('Could not find track for dragged item:', dragItem.id);
      const updatedItems = mediaItems.map(item =>
        item.id === dragItem.id
          ? { ...item, startTime: snappedTime }
          : item
      );
      onItemsUpdate(updatedItems);
      return;
    }
    
    // If user hasn't moved significantly in Y direction, keep item on current track
    if (!shouldAllowTrackChange) {
      // Just move horizontally on the same track
      const currentTrackItems = draggedItemTrackType === 'video' 
        ? (allTrackAssignments.videoTracks[draggedItemTrackIndex] || [])
        : (allTrackAssignments.audioTracks[draggedItemTrackIndex] || []);
      
      // Use smart snapping to adjacent items on the same track
      const smartSnappedTime = getSmartSnappedTime(newStartTime, dragItem.id, currentTrackItems);
      
      const otherItemsOnTrack = currentTrackItems.filter(item => item.id !== dragItem.id);
      const dragItemEnd = smartSnappedTime + dragItem.duration;
      
      // Check collision on current track only
      const hasCollision = otherItemsOnTrack.some(item => {
        const itemEnd = item.startTime + item.duration;
        return (smartSnappedTime < itemEnd - COLLISION_TOLERANCE && dragItemEnd > item.startTime + COLLISION_TOLERANCE);
      });
      
      if (!hasCollision) {
        // Allow horizontal movement on same track with smart snapping
        const updatedItems = mediaItems.map(item =>
          item.id === dragItem.id
            ? { ...item, startTime: smartSnappedTime }
            : item
        );
        onItemsUpdate(updatedItems);
        return;
      }
      // If there's collision on current track, fall through to track changing logic
    }
    
    const isDraggingAudio = dragItem.type === 'audio';
    const videoTrackCount = Math.max(1, allTrackAssignments.videoTracks.length); // Always at least 1 video track shown
    const audioTrackCount = allTrackAssignments.audioTracks.length;
    
    // COMPLETELY SEPARATE TRACK SYSTEMS
    if (isDraggingAudio) {
      // AUDIO TRACK SYSTEM: Only consider the audio section of the timeline
      const actualGapHeight = allTrackAssignments.audioTracks.length > 0 ? trackGap : 0; // Only add gap if audio tracks exist
      const audioSectionStartY = (videoTrackCount * trackHeight) + actualGapHeight;
      const audioMouseY = mouseYInTracks - audioSectionStartY;
      let targetAudioTrackIndex = Math.floor(audioMouseY / trackHeight);
      
      // If mouse is above audio section, don't allow the move
      if (audioMouseY < 0) {
        return; // Can't drag audio into video section
      }
      
      // Check if creating new audio track
      const isNewAudioTrack = targetAudioTrackIndex >= audioTrackCount;
      
      if (isNewAudioTrack) {
        // Create new audio track - use absolute UI position with smart snapping
        const newAudioTrackIndex = audioTrackCount;
        const absoluteTrackIndex = videoTrackCount + newAudioTrackIndex;
        const allAudioItems = allTrackAssignments.audioTracks.flat();
        const smartSnappedTime = getSmartSnappedTime(snappedTime, dragItem.id, allAudioItems);
        
        const updatedItems = mediaItems.map(item =>
          item.id === dragItem.id
            ? {
                ...item,
                startTime: smartSnappedTime,
                forceTrackIndex: absoluteTrackIndex // Absolute UI position
              }
            : item
        );
        onItemsUpdate(updatedItems);
        return;
      }
      
      // Clamp to existing audio tracks
      if (targetAudioTrackIndex < 0) targetAudioTrackIndex = 0;
      if (targetAudioTrackIndex >= audioTrackCount) targetAudioTrackIndex = audioTrackCount - 1;
      
      // Get items from target audio track
      const targetAudioTrackItems = (allTrackAssignments.audioTracks[targetAudioTrackIndex] || [])
        .filter(item => item.id !== dragItem.id);
      
      // Check collision in target audio track
      const dragItemEnd = snappedTime + dragItem.duration;
      const hasCollision = targetAudioTrackItems.some(item => {
        const itemEnd = item.startTime + item.duration;
        return (snappedTime < itemEnd - COLLISION_TOLERANCE && dragItemEnd > item.startTime + COLLISION_TOLERANCE);
      });
      
      let finalTime = snappedTime;
      
      // If collision, find best position in audio track
      if (hasCollision) {
        const sortedItems = targetAudioTrackItems.sort((a, b) => a.startTime - b.startTime);
        let bestPosition = snappedTime;
        let minDistance = Infinity;
        
        // Try after each item
        sortedItems.forEach(item => {
          const afterPosition = item.startTime + item.duration;
          const afterEnd = afterPosition + dragItem.duration;
          
          const wouldConflict = sortedItems.some(otherItem => {
            if (otherItem.id === item.id) return false;
            const otherEnd = otherItem.startTime + otherItem.duration;
            return (afterPosition < otherEnd - COLLISION_TOLERANCE && afterEnd > otherItem.startTime + COLLISION_TOLERANCE);
          });
          
          if (!wouldConflict) {
            const distance = Math.abs(afterPosition - snappedTime);
            if (distance < minDistance) {
              bestPosition = afterPosition;
              minDistance = distance;
            }
          }
        });
        
        // Try before each item
        sortedItems.forEach(item => {
          const beforePosition = item.startTime - dragItem.duration;
          if (beforePosition >= 0) {
            const beforeEnd = beforePosition + dragItem.duration;
            
            const wouldConflict = sortedItems.some(otherItem => {
              if (otherItem.id === item.id) return false;
              const otherEnd = otherItem.startTime + otherItem.duration;
              return (beforePosition < otherEnd - COLLISION_TOLERANCE && beforeEnd > otherItem.startTime + COLLISION_TOLERANCE);
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
        
        // Try at beginning
        if (targetAudioTrackItems.length === 0 || targetAudioTrackItems[0].startTime >= dragItem.duration) {
          const distance = Math.abs(0 - snappedTime);
          if (distance < minDistance) {
            bestPosition = 0;
            minDistance = distance;
          }
        }
        
        if (minDistance < Infinity && minDistance <= dragItem.duration * 3) {
          finalTime = Math.max(0, bestPosition);
        } else {
          return; // Block move
        }
      }
      
      // Update audio item position - use absolute UI position with smart snapping
      const absoluteTrackIndex = videoTrackCount + targetAudioTrackIndex;
      const smartSnappedFinalTime = getSmartSnappedTime(finalTime, dragItem.id, targetAudioTrackItems);
      
      const updatedItems = mediaItems.map(item =>
        item.id === dragItem.id
          ? {
              ...item,
              startTime: smartSnappedFinalTime,
              forceTrackIndex: absoluteTrackIndex // Absolute UI position
            }
          : item
      );
      onItemsUpdate(updatedItems);
      return;
    }
    
    // VIDEO TRACK SYSTEM: Only consider the video section of the timeline  
    let targetVideoTrackIndex = Math.floor(mouseYInTracks / trackHeight);
    
    // For videos, block if mouse is in the audio section (after gap)
    if (!isDraggingAudio && audioTrackCount > 0) {
      const videoSectionEndY = videoTrackCount * trackHeight;
      const audioSectionStartY = videoSectionEndY + trackGap;
      
      // Block if dragging into audio section
      if (mouseYInTracks >= audioSectionStartY) {
        return; // Can't drag video into audio section
      }
    }
    
    // Check if creating new video track
    const isNewVideoTrack = targetVideoTrackIndex >= videoTrackCount;
    
    // If creating new video track, place it at the end of video tracks
    if (isNewVideoTrack) {
      const newVideoTrackIndex = videoTrackCount;
      const allVideoItems = allTrackAssignments.videoTracks.flat();
      const smartSnappedTime = getSmartSnappedTime(snappedTime, dragItem.id, allVideoItems);
      
      const updatedItems = mediaItems.map(item =>
        item.id === dragItem.id
          ? {
              ...item,
              startTime: smartSnappedTime,
              forceTrackIndex: newVideoTrackIndex // Direct video track index
            }
          : item
      );
      onItemsUpdate(updatedItems);
      return;
    }
    
    // Clamp target track to valid range for existing video tracks
    if (targetVideoTrackIndex < 0) targetVideoTrackIndex = 0;
    if (targetVideoTrackIndex >= videoTrackCount) targetVideoTrackIndex = videoTrackCount - 1;
    
    // Get items from the target video track for collision detection
    const targetVideoTrackItems = (allTrackAssignments.videoTracks[targetVideoTrackIndex] || [])
      .filter(item => item.id !== dragItem.id);
    
    // Check collision with items on target video track
    const dragItemEnd = snappedTime + dragItem.duration;
    const hasCollision = targetVideoTrackItems.some(item => {
      const itemEnd = item.startTime + item.duration;
      return (snappedTime < itemEnd - COLLISION_TOLERANCE && dragItemEnd > item.startTime + COLLISION_TOLERANCE);
    });
    
    let finalTime = snappedTime;
    
    // If there's collision on target video track, find closest available position
    if (hasCollision) {
      const sortedItems = targetVideoTrackItems.sort((a, b) => a.startTime - b.startTime);
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
          return (afterPosition < otherEnd - COLLISION_TOLERANCE && afterEnd > otherItem.startTime + COLLISION_TOLERANCE);
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
            return (beforePosition < otherEnd - COLLISION_TOLERANCE && beforeEnd > otherItem.startTime + COLLISION_TOLERANCE);
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
      
      // Option 3: Try placing at the very beginning (time 0)
      if (targetVideoTrackItems.length === 0 || targetVideoTrackItems[0].startTime >= dragItem.duration) {
        const distance = Math.abs(0 - snappedTime);
        if (distance < minDistance) {
          bestPosition = 0;
          minDistance = distance;
        }
      }
      
      // Only use the best position if it's reasonably close, otherwise block the move
      if (minDistance < Infinity && minDistance <= dragItem.duration * 3) {
        finalTime = Math.max(0, bestPosition);
      } else {
        // No good position found, block the move
        return;
      }
    }
    
    // Allow the move to target video track with final time and smart snapping
    const updatedItems = mediaItems.map(item =>
      item.id === dragItem.id
        ? {
            ...item,
            startTime: getSmartSnappedTime(finalTime, dragItem.id, targetVideoTrackItems),
            forceTrackIndex: targetVideoTrackIndex // Direct video track index
          }
        : item
    );
    onItemsUpdate(updatedItems);
  }, [isDragging, dragItem, dragOffset, scale, mediaItems, onItemsUpdate, calculateTrackAssignments, selectedItems, getSmartSnappedTime]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragItem(null);
    setDragOffset(0);
    setDragTargetTrack(null); // Clear drag target
    // Clear multi-select drag refs
    dragStartMouseX.current = null;
    dragStartPositions.current.clear();
    // Clear single-item drag tracking refs
    dragStartMouseY.current = null;
    dragStartTrackIndex.current = null;
    // Don't automatically close context menu on mouse up
  }, []);

  // Handle timeline tracks click for deselection
  const handleTracksClick = useCallback((e) => {
    // Only deselect if clicking on the tracks area itself, not on an item
    // Also check if we're not currently dragging or selecting to avoid interfering with those operations
    if (!isDragging && !isSelecting && (e.target.classList.contains('timeline-tracks') || 
        e.target.classList.contains('timeline-track'))) {
      setSelectedItems(new Set());
    }
  }, [isDragging, isSelecting]);

  // Handle mouse wheel for smooth timeline zooming
  const handleWheel = useCallback((e) => {
    // Only handle wheel events that are specifically on timeline elements
    if (!e.target.closest('.timeline-container')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation(); // Prevent affecting parent containers
    
    // Calculate new scale with smooth increments
    const zoomFactor = e.deltaY > 0 ? 0.85 : 1.18; // More granular zoom steps
    const newScale = Math.max(2, Math.min(200, scale * zoomFactor)); // Wider zoom range
    
    setScale(newScale);
  }, [scale]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e, item) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If right-clicking on an item that's not selected, select only that item
    // If right-clicking on an already selected item, keep the current selection
    if (!selectedItems.has(item.id)) {
      setSelectedItems(new Set([item.id]));
    }
    
    // Position menu above the cursor
    const menuHeight = 180; // Approximate height of context menu
    const x = e.clientX;
    const y = e.clientY - menuHeight; // Position above cursor
    
    setContextMenu({
      x: x,
      y: y,
      item: item,
      selectedCount: selectedItems.has(item.id) ? selectedItems.size : 1
    });
  }, [selectedItems]);

  // Close context menu
  const closeContextMenu = useCallback((e) => {
    // Don't close if clicking inside the context menu
    if (e && e.target && e.target.closest('.context-menu')) {
      return;
    }
    setContextMenu(null);
  }, []);

  // Toggle track lock for all selected items
  const toggleTrackLock = useCallback(() => {
    const selectedItemsList = mediaItems.filter(item => selectedItems.has(item.id));
    const allLocked = selectedItemsList.every(item => lockedTracks.has(item.id));
    
    setLockedTracks(prev => {
      const newSet = new Set(prev);
      selectedItemsList.forEach(item => {
        if (allLocked) {
          newSet.delete(item.id);
      } else {
          newSet.add(item.id);
      }
      });
      return newSet;
    });
    closeContextMenu();
  }, [mediaItems, selectedItems, lockedTracks, closeContextMenu]);

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
          return !(finalStartTime >= existingEnd - COLLISION_TOLERANCE || newEnd <= existingItem.startTime + COLLISION_TOLERANCE);
        });
        
        if (!hasOverlap) break;
        
        // Move to the end of the conflicting items
        const conflictingItems = mediaItems.filter(existingItem => {
          const newEnd = finalStartTime + newItem.duration;
          const existingEnd = existingItem.startTime + existingItem.duration;
          return !(finalStartTime >= existingEnd - COLLISION_TOLERANCE || newEnd <= existingItem.startTime + COLLISION_TOLERANCE);
        });
        
        if (conflictingItems.length > 0) {
          const maxEndTime = Math.max(...conflictingItems.map(item => item.startTime + item.duration));
          finalStartTime = maxEndTime; // Perfect back-to-back placement
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
      // Try to place right after the original item (perfect back-to-back)
      let newStartTime = item.startTime + item.duration;
      
      // Check for overlaps and adjust if needed
      const hasOverlap = mediaItems.some(existingItem => {
        if (existingItem.id === item.id) return false; // Skip the original item
        const newEnd = newStartTime + item.duration;
        const existingEnd = existingItem.startTime + existingItem.duration;
        return !(newStartTime >= existingEnd - COLLISION_TOLERANCE || newEnd <= existingItem.startTime + COLLISION_TOLERANCE);
      });
      
      if (hasOverlap) {
        // Find the latest end time and place after it
        const endTimes = mediaItems.map(mediaItem => mediaItem.startTime + mediaItem.duration);
        newStartTime = Math.max(...endTimes);
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

  // Separate mouse event handlers for scrubbing to avoid conflicts
  useEffect(() => {
    if (!isScrubbing && !rulerMouseDown) return;

    const handleScrubMouseMove = (e) => {
      if (isScrubbing) {
        const rect = timelineRef.current?.getBoundingClientRect();
        if (rect) {
          const mouseX = e.clientX - rect.left;
          const newTime = Math.max(0, Math.min(duration, mouseX / scale));
          onTimeUpdate(newTime);
        }
      } else if (rulerMouseDown && !isDragging) {
        // Check if we should start scrubbing or selection
        const deltaX = Math.abs(e.clientX - rulerMouseDownPos.current.x);
        const deltaY = Math.abs(e.clientY - rulerMouseDownPos.current.y);
        if (deltaX > 3 || deltaY > 3) {
          // If dragging more vertically, start selection; if more horizontally, start scrubbing
          if (deltaY > deltaX) {
            // Start selection
            setIsSelecting(true);
            setRulerMouseDown(false);
            
            // Initialize selection box
            const rect = timelineRef.current?.getBoundingClientRect();
            if (rect) {
              const currentX = e.clientX - rect.left;
              const currentY = e.clientY - rect.top;
              const startX = selectStartPos.current.x;
              const startY = selectStartPos.current.y;
              
              const left = Math.min(startX, currentX);
              const top = Math.min(startY, currentY);
              const width = Math.abs(currentX - startX);
              const height = Math.abs(currentY - startY);
              
              setSelectionBox({ x: left, y: top, width, height });
            }
          } else {
            // Start scrubbing
            setIsScrubbing(true);
          }
        }
      }
    };

    const handleScrubMouseUp = () => {
      setIsScrubbing(false);
      setRulerMouseDown(false);
    };

    document.addEventListener('mousemove', handleScrubMouseMove);
    document.addEventListener('mouseup', handleScrubMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleScrubMouseMove);
      document.removeEventListener('mouseup', handleScrubMouseUp);
    };
  }, [isScrubbing, rulerMouseDown, isDragging, scale, duration, onTimeUpdate]);

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

  // Debug context menu state changes
  useEffect(() => {
    console.log('Context menu state changed:', contextMenu);
    if (contextMenu) {
      console.log('Context menu should be visible at:', contextMenu.x, contextMenu.y);
    } else {
      console.log('Context menu should be hidden');
    }
  }, [contextMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if user is typing in an input field
      const isTyping = document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable
      );

      // Check if the focus is within the timeline container or timeline has selected items and user recently interacted with timeline
      const timelineContainer = timelineRef.current;
      const isFocusInTimeline = timelineContainer && (
        timelineContainer.contains(document.activeElement) ||
        timelineContainer.contains(e.target) ||
        e.target.closest('.timeline-container')
      );


      const shouldHandleDelete = !isTyping && (
        isFocusInTimeline || 
        (selectedItems.size > 0 && !document.activeElement?.closest('.source-media-panel'))
      );

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (shouldHandleDelete && selectedItems.size > 0) {
          deleteSelectedItems();
        }
      } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        if (!isTyping && selectedItems.size > 0) {
          copySelectedItems();
        }
      } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        if (!isTyping) {
          pasteItems();
        }
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        if (!isTyping) {
          e.preventDefault();
          if (selectedItems.size > 0) {
            duplicateSelectedItems();
          }
        }
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        if (!isTyping) {
          e.preventDefault();
          setSelectedItems(new Set(mediaItems.map(item => item.id)));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, deleteSelectedItems, copySelectedItems, pasteItems, duplicateSelectedItems, mediaItems]);

  return (
    <div>
      <div 
        ref={timelineRef}
        className="timeline-container" 
        style={{
          border: '1px solid #333',
          borderTop: 'none',
          contain: 'layout style paint size',
          isolation: 'isolate',
          height: '300px',
          minHeight: '300px',
          maxHeight: '300px',
          overflow: 'hidden'
        }}
        onWheel={handleWheel}
      >
        {/* Selection box overlay at container level */}
        {isSelecting && selectionBox && (
          <div
            style={{
              position: 'absolute',
              left: `${selectionBox.x}px`,
              top: `${selectionBox.y}px`,
              width: `${selectionBox.width}px`,
              height: `${selectionBox.height}px`,
              background: 'rgba(139, 92, 246, 0.2)',
              border: '1px solid #8b5cf6',
              pointerEvents: 'none',
              zIndex: 20
            }}
          />
        )}

        <div className="timeline-header" style={{
          background: '#2a2a2a',
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '40px',
          position: 'relative'
        }}>
          <span style={{ fontSize: '13px', fontWeight: '500', color: '#fff' }}>Timeline</span>
          
          <button 
            onClick={onPlayPause}
            style={{
              background: '#444',
              color: 'white',
              border: 'none',
              width: '28px',
              height: '28px',
              minWidth: '28px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              cursor: 'pointer',
              transition: 'none',
              flexShrink: 0,
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              boxSizing: 'border-box',
              outline: 'none',
              padding: 0,
              margin: 0
            }}
          >
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              fontFamily: 'monospace',
              fontWeight: 'bold'
            }}>
              {isPlaying ? '||' : '▶'}
            </span>
          </button>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#999' }}>
              Selected: {selectedItems.size} | Copied: {copiedItems.length}
            </span>
            <span style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace' }}>
              {Math.floor(currentTime / 60)}:{Math.round((currentTime % 60) * 10) / 10} / {Math.floor(duration / 60)}:{Math.round((duration % 60) * 10) / 10}
            </span>
          </div>
        </div>
        
        <div 
          className="timeline-ruler" 
          onClick={handleTimelineClick}
          onMouseDown={handleRulerMouseDown}
          onDrop={handleTimelineDrop}
          onDragOver={handleTimelineDragOver}
          style={{ 
            position: 'relative', 
            height: '32px', 
            background: '#252525', 
            cursor: isScrubbing ? 'grabbing' : 'pointer',
            borderBottom: '1px solid #333',
            overflowX: 'auto',
            overflowY: 'hidden'
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
          position: 'relative',
          overflowX: 'auto',
          overflowY: 'hidden'
        }}
          onDrop={handleTimelineDrop}
          onDragOver={handleTimelineDragOver}
          onClick={handleTracksClick}
          onMouseDown={handleTracksMouseDown}
          onMouseMove={handleTimelineMouseMove}
          onMouseUp={handleTimelineMouseUp}
        >
          {/* Timeline content container with proper width */}
          <div style={{
            position: 'relative',
            minWidth: `${Math.max(800, duration * scale + 100)}px`,
            width: '100%'
          }}>
            {/* Video Tracks - Always show at least one */}
            {Math.max(1, trackAssignments.videoTracks.length) > 0 && Array.from({ length: Math.max(1, trackAssignments.videoTracks.length) }, (_, trackIndex) => {
              const track = trackAssignments.videoTracks[trackIndex] || [];
              return (
                <div
                  key={`video-${trackIndex}`}
                  className={`timeline-track ${lockedTracks.has(`video-${trackIndex}`) ? 'locked' : ''}`}
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
                    🎬 Video {trackIndex + 1} {lockedTracks.has(`video-${trackIndex}`) && '🔒'}
                  </div>

                  {/* Track items */}
                  {track && track.map && track.map(item => {
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

            {/* Video Track Drop Zone - show immediately after video tracks when dragging video items */}
            {isDragging && dragItem && dragItem.type !== 'audio' && (
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
                    ✨ Drop here to create new video track
                  </span>
                ) : (
                  <span>
                    Drop here to create new video track
                  </span>
                )}
              </div>
            )}

            {/* Visual Gap Between Video and Audio Tracks */}
            {trackAssignments.audioTracks.length > 0 && (
              <div style={{
                height: '20px',
                background: '#0a0a0a',
                borderTop: '1px solid #333',
                borderBottom: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: '#555',
                fontWeight: '500',
                width: '100%',
                minWidth: `${duration * scale}px`
              }}>
                AUDIO
              </div>
            )}

            {/* Audio Tracks - Rendered at the bottom after gap */}
            {trackAssignments.audioTracks && trackAssignments.audioTracks.map && trackAssignments.audioTracks.map((track, trackIndex) => (
              <div
                key={`audio-${trackIndex}`}
                className={`timeline-track ${lockedTracks.has(`audio-${trackIndex}`) ? 'locked' : ''}`}
                style={{
                  height: '50px',
                  borderBottom: '1px solid #2a2a2a',
                  position: 'relative',
                  background: dragTargetTrack?.index === (trackAssignments.videoTracks.length + trackIndex) && dragTargetTrack?.canPlaceHere ? 
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
                {track && track.map && track.map(item => {
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

            {/* Audio Track Drop Zone - only show when dragging audio items and after audio section */}
            {isDragging && dragItem && dragItem.type === 'audio' && trackAssignments.audioTracks.length > 0 && (
              <div
                style={{
                  height: '50px',
                  borderBottom: '2px dashed #444',
                  position: 'relative',
                  background: dragTargetTrack?.isNewTrack ? 
                             'rgba(6, 182, 212, 0.1)' : 
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
                  <span style={{ color: '#06b6d4' }}>
                    ✨ Drop here to create new audio track
                  </span>
                ) : (
                  <span>
                    Drop here to create new audio track
                  </span>
                )}
              </div>
            )}
            
            {/* Calculate total height needed */}
            <div style={{ 
              height: `${Math.max(1, (trackAssignments.videoTracks.length + Math.max(1, trackAssignments.audioTracks.length))) * 50 + 20}px` 
            }} />
          </div>
        </div>

        {/* Help text */}
        <div style={{ 
          padding: '8px 16px', 
          fontSize: '10px', 
          color: '#666',
          borderTop: '1px solid #2a2a2a',
          background: '#1a1a1a',
          fontWeight: '400'
        }}>
          💡 Shift+Click: Multi-select | Drag: Select multiple | Scroll: Zoom timeline | Right-click: Context menu
        </div>
      </div>

      {/* Context Menu - rendered outside timeline container for proper positioning */}
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
            zIndex: 10000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={toggleTrackLock}
          >
            {(() => {
              const selectedItemsList = mediaItems.filter(item => selectedItems.has(item.id));
              const allLocked = selectedItemsList.every(item => lockedTracks.has(item.id));
              const itemText = selectedItems.size > 1 ? `${selectedItems.size} Items` : 'Item';
              return allLocked ? `🔓 Unlock ${itemText}` : `🔒 Lock ${itemText}`;
            })()}
          </div>
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={copySelectedItems}
          >
            📋 Copy {selectedItems.size > 1 ? `${selectedItems.size} Items` : ''} (Ctrl+C)
          </div>
          <div 
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}
            onMouseEnter={(e) => e.target.style.background = '#3a3a3a'}
            onMouseLeave={(e) => e.target.style.background = 'transparent'}
            onClick={duplicateSelectedItems}
          >
            📋 Duplicate {selectedItems.size > 1 ? `${selectedItems.size} Items` : ''} (Ctrl+D)
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
            🗑️ Delete {selectedItems.size > 1 ? `${selectedItems.size} Items` : ''} (Del)
          </div>
        </div>
      )}
    </div>
  );
});

export default Timeline;