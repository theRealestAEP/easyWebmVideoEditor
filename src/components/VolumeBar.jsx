import React, { useRef, useEffect, useState, useCallback } from 'react';

const VolumeBar = ({ audioElements, isPlaying }) => {
  const canvasRef = useRef();
  const animationFrameRef = useRef();
  const analyserNodes = useRef(new Map());
  const audioContextRef = useRef(null);
  const masterGainNode = useRef(null);
  const masterAnalyser = useRef(null);
  const [levels, setLevels] = useState({ left: -60, right: -60 });
  const [peakLevels, setPeakLevels] = useState({ left: -60, right: -60 });
  const peakHoldTime = useRef({ left: 0, right: 0 });
  const [isSupported, setIsSupported] = useState(true);
  const [debugInfo, setDebugInfo] = useState('');
  
  // Initialize audio context
  const getAudioContext = () => {
    // Check if we need to create a new audio context
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      try {
        // console.log('🔧 Creating new audio context (previous was', audioContextRef.current?.state || 'null', ')');
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        
        // Reset the master nodes when creating new context
        masterGainNode.current = null;
        masterAnalyser.current = null;
        
        // console.log('✅ New audio context created, state:', audioContextRef.current.state);
      } catch (error) {
        // console.warn('❌ Web Audio API not supported:', error);
        setIsSupported(false);
        return null;
      }
    }
    return audioContextRef.current;
  };
  
  // Initialize master analyser for mixed audio
  const initializeMasterAnalyser = () => {
    const audioContext = getAudioContext();
    if (!audioContext) {
    //   console.error('❌ Cannot initialize master analyser: no audio context');
      return null;
    }
    
    // console.log('🔧 initializeMasterAnalyser called, audioContext state:', audioContext.state);
    
    if (!masterAnalyser.current) {
      try {
        // console.log('🔧 Creating master gain and analyser nodes...');
        
        // Create master gain node and analyser
        masterGainNode.current = audioContext.createGain();
        masterAnalyser.current = audioContext.createAnalyser();
        
        // Configure analyser for better level detection
        masterAnalyser.current.fftSize = 2048;
        masterAnalyser.current.smoothingTimeConstant = 0.8;
        masterAnalyser.current.minDecibels = -90;
        masterAnalyser.current.maxDecibels = -10;
        
        // Connect master gain to analyser, then analyser to destination
        // This ensures we can analyze the audio while still hearing it
        masterGainNode.current.connect(masterAnalyser.current);
        masterAnalyser.current.connect(audioContext.destination);
        
        // console.log('✅ Master analyser initialized successfully');
        // console.log('✅ Audio chain: masterGainNode → masterAnalyser → destination');
        // console.log('✅ Analyser config:', {
        //   fftSize: masterAnalyser.current.fftSize,
        //   frequencyBinCount: masterAnalyser.current.frequencyBinCount,
        //   minDecibels: masterAnalyser.current.minDecibels,
        //   maxDecibels: masterAnalyser.current.maxDecibels
        // });
        
      } catch (error) {
        console.error('❌ Failed to create master analyser:', error);
        return null;
      }
    } else {
    //   console.log('✅ Master analyser already exists');
    }
    
    return masterAnalyser.current;
  };
  
  // Initialize audio analysis for each audio element
  useEffect(() => {
    if (!isSupported) return;
    
    // Only run if we have audio elements to connect
    if (audioElements.size === 0) {
    //   console.log('🔍 VolumeBar: No audio elements to connect yet');
      return;
    }
    
    // console.log('🔍 VolumeBar: Initializing analysers...');
    // console.log('🔍 VolumeBar: audioElements:', audioElements);
    // console.log('🔍 VolumeBar: audioElements.size:', audioElements.size);
    // console.log('🔍 VolumeBar: isPlaying:', isPlaying);
    
    const initializeAnalysers = async () => {
      const audioContext = getAudioContext();
      if (!audioContext) return;
      
    //   console.log('🔍 VolumeBar: Audio context state:', audioContext.state);
      
      // Resume audio context if suspended (required by browser policy)
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        //   console.log('✅ Audio context resumed, new state:', audioContext.state);
        } catch (error) {
        //   console.warn('❌ Could not resume audio context:', error);
          setIsSupported(false);
          return;
        }
      }
      
      // Initialize master analyser FIRST
      const masterAnalyserNode = initializeMasterAnalyser();
      if (!masterAnalyserNode) {
        // console.warn('❌ Failed to initialize master analyser');
        return;
      }
      
      let connectedCount = 0;
      let alreadyConnectedCount = 0;
      
      // Log all audio elements with detailed state
    //   console.log('🔍 VolumeBar: Processing audio elements...');
      for (const [id, audio] of audioElements.entries()) {
        // console.log('🔍 VolumeBar: Audio element details:', {
        //   id,
        //   paused: audio.paused,
        //   currentTime: audio.currentTime,
        //   duration: audio.duration,
        //   src: audio.src,
        //   readyState: audio.readyState,
        //   volume: audio.volume,
        //   muted: audio.muted,
        //   networkState: audio.networkState,
        //   crossOrigin: audio.crossOrigin
        // });
        
        if (!analyserNodes.current.has(id)) {
          try {
            // console.log(`🔍 Attempting to connect NEW audio element: ${id}`);
            
            // Important: Create media element source (can only be done once per element)
            // This will disconnect the audio from the normal browser output path
            // and route it through our Web Audio API chain
            const source = audioContext.createMediaElementSource(audio);
            
            // Connect to master gain node which routes to both analyser and speakers
            source.connect(masterGainNode.current);
            
            // console.log(`🔗 Connected NEW audio ${id}: source → masterGainNode → masterAnalyser → destination`);
            // console.log(`🔊 This audio will now play through Web Audio API only`);
            
            // Store the source for cleanup
            analyserNodes.current.set(id, {
              source,
              audioElement: audio,
              connected: true,
              connectedAt: Date.now()
            });
            
            connectedCount++;
            // console.log(`✅ Connected NEW audio element: ${id}`);
            
          } catch (error) {
            // console.warn(`❌ Failed to connect audio element ${id}:`, error);
            
            if (error.name === 'InvalidStateError') {
            //   console.warn('Audio element already connected - this is expected behavior');
              // Mark as connected even if we can't create a new source
              analyserNodes.current.set(id, {
                source: null,
                audioElement: audio,
                connected: false,
                alreadyConnected: true
              });
              alreadyConnectedCount++;
            } else {
              console.error('Unexpected error connecting audio element:', error);
            }
          }
        } else {
        //   console.log(`🔗 Audio element ${id} already has analyser node`);
          alreadyConnectedCount++;
        }
      }
      
      // Clean up removed audio elements
      let cleanedUpCount = 0;
      for (const [id, analyserData] of analyserNodes.current.entries()) {
        if (!audioElements.has(id)) {
          try {
            if (analyserData.source) {
              analyserData.source.disconnect();
            }
            cleanedUpCount++;
          } catch (error) {
            // console.warn('Error disconnecting audio source:', error);
          }
          analyserNodes.current.delete(id);
        }
      }
      
      const debugMsg = `Connected: ${connectedCount}/${audioElements.size} | Existing: ${alreadyConnectedCount} | Cleaned: ${cleanedUpCount}`;
      setDebugInfo(debugMsg);
    //   console.log(`📊 Audio analysis setup complete: ${debugMsg}`);
      
      // Log the state of each connected audio element
    //   console.log('🔍 VolumeBar: All connected audio elements:');
      for (const [id, analyserData] of analyserNodes.current.entries()) {
        const audio = analyserData.audioElement;
        // console.log(`  - ${id}:`, {
        //   connected: analyserData.connected,
        //   alreadyConnected: analyserData.alreadyConnected,
        //   paused: audio.paused,
        //   currentTime: audio.currentTime?.toFixed(2),
        //   volume: audio.volume,
        //   muted: audio.muted,
        //   connectedAt: analyserData.connectedAt ? new Date(analyserData.connectedAt).toLocaleTimeString() : 'N/A'
        // });
      }
    };
    
    initializeAnalysers();
  }, [audioElements, isSupported, isPlaying]);
  
  // Real-time audio level monitoring with better timeline audio detection
  useEffect(() => {
    // console.log('🔍 VolumeBar: Level monitoring effect triggered');
    // console.log('🔍 VolumeBar: isPlaying:', isPlaying);
    // console.log('🔍 VolumeBar: isSupported:', isSupported);
    // console.log('🔍 VolumeBar: masterAnalyser.current:', !!masterAnalyser.current);
    // console.log('🔍 VolumeBar: audioElements.size:', audioElements.size);
    
    // Check if any audio elements are actually playing with detailed logging
    let actuallyPlaying = false;
    let playingDetails = [];
    
    for (const [id, audio] of audioElements.entries()) {
      const isAudioPlaying = audio && !audio.paused && audio.currentTime > 0;
      playingDetails.push({
        id,
        paused: audio.paused,
        currentTime: audio.currentTime?.toFixed(2),
        isPlaying: isAudioPlaying,
        volume: audio.volume,
        muted: audio.muted
      });
      
      if (isAudioPlaying) {
        actuallyPlaying = true;
      }
    }
    
    // console.log('🔍 VolumeBar: Timeline audio detailed state:', playingDetails);
    // console.log('🔍 VolumeBar: actuallyPlaying:', actuallyPlaying);
    
    // TRY TO INITIALIZE MASTER ANALYSER if we don't have one but should monitor
    if ((isPlaying || actuallyPlaying) && isSupported && !masterAnalyser.current) {
    //   console.log('🔧 Attempting to initialize master analyser for monitoring...');
      const analyser = initializeMasterAnalyser();
      if (analyser) {
        // console.log('✅ Master analyser initialized for monitoring');
      } else {
        // console.error('❌ Failed to initialize master analyser for monitoring');
      }
    }
    
    // Re-calculate shouldMonitor after potential initialization
    const finalShouldMonitor = (isPlaying || actuallyPlaying) && isSupported && masterAnalyser.current;
    
    // console.log('🔍 VolumeBar: Final shouldMonitor after init attempt:', finalShouldMonitor);
    
    if (!finalShouldMonitor) {
    //   console.log('❌ VolumeBar: Not starting level monitoring - conditions not met');
      
      // Reset levels when not playing
      setLevels({ left: -60, right: -60 });
      setPeakLevels({ left: -60, right: -60 });
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }
    
    // console.log('✅ VolumeBar: Starting level monitoring...');
    // console.log('✅ VolumeBar: Monitoring reasons - isPlaying:', isPlaying, 'actuallyPlaying:', actuallyPlaying);
    
    const analyser = masterAnalyser.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(analyser.fftSize);
    
    let frameCount = 0;
    
    const updateLevels = () => {
      if (!analyser) {
        // console.warn('❌ No analyser in updateLevels');
        return;
      }
      
      frameCount++;
      
      try {
        // Get frequency data for spectrum analysis
        analyser.getByteFrequencyData(dataArray);
        
        // Get time domain data for RMS calculation
        analyser.getByteTimeDomainData(timeDataArray);
        
        // Calculate RMS level from time domain data
        const rms = calculateRMSFromTimeDomain(timeDataArray);
        
        // Convert to dB with proper scaling
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        
        // For stereo, we'll use the same level for both channels
        // (master analyser mixes all channels)
        const leftDB = Math.max(-60, Math.min(6, db));
        const rightDB = leftDB; // Same for both channels from master mix
        
        // Log every 30 frames (roughly twice per second at 60fps) for better debugging
        if (frameCount % 30 === 0) {
          // Check timeline audio states
          let timelineAudioInfo = [];
          for (const [id, audio] of audioElements.entries()) {
            timelineAudioInfo.push({
              id,
              paused: audio.paused,
              currentTime: audio.currentTime?.toFixed(2),
              volume: audio.volume,
              connected: analyserNodes.current.has(id)
            });
          }
          
        //   console.log('🔍 VolumeBar: Audio analysis frame:', {
        //     frameCount,
        //     rms: rms.toFixed(4),
        //     db: db.toFixed(1),
        //     leftDB: leftDB.toFixed(1),
        //     rightDB: rightDB.toFixed(1),
        //     timelineAudioInfo,
        //     timeDataSample: Array.from(timeDataArray.slice(0, 10)),
        //     freqDataSample: Array.from(dataArray.slice(0, 10)),
        //     analyserConnected: !!analyser,
        //     analyserContext: analyser.context?.state
        //   });
          
          // Check if we're getting any non-zero data
          const hasTimeData = timeDataArray.some(val => val !== 128); // 128 is silence in time domain
          const hasFreqData = dataArray.some(val => val > 0);
        //   console.log('🔍 VolumeBar: Data check - hasTimeData:', hasTimeData, 'hasFreqData:', hasFreqData);
          
          // If we have timeline audio playing but no data, that's the problem
          const timelineAudioPlaying = timelineAudioInfo.some(info => !info.paused && parseFloat(info.currentTime) > 0);
          if (timelineAudioPlaying && !hasTimeData && !hasFreqData) {
            console.warn('🚨 ISSUE DETECTED: Timeline audio is playing but no audio data in analyser!');
            console.warn('🚨 This suggests timeline audio is not properly routed through Web Audio API');
          }
        }
        
        // Rest of the level monitoring code...
        setLevels(prev => ({
          left: Math.max(-60, Math.min(6, leftDB * 0.7 + prev.left * 0.3)),
          right: Math.max(-60, Math.min(6, rightDB * 0.7 + prev.right * 0.3))
        }));
        
        // Update peak levels with hold time
        const now = Date.now();
        setPeakLevels(prev => {
          const newPeaks = { ...prev };
          
          // Update left peak
          if (leftDB > prev.left || (now - peakHoldTime.current.left) > 1500) {
            newPeaks.left = leftDB;
            peakHoldTime.current.left = now;
          }
          
          // Update right peak
          if (rightDB > prev.right || (now - peakHoldTime.current.right) > 1500) {
            newPeaks.right = rightDB;
            peakHoldTime.current.right = now;
          }
          
          return newPeaks;
        });
        
        // Check if any audio elements are actually playing
        let playingCount = 0;
        const audioElementStates = [];
        
        for (const [id, analyserData] of analyserNodes.current.entries()) {
          const audio = analyserData.audioElement;
          if (audio && !audio.paused && audio.currentTime > 0) {
            playingCount++;
          }
          audioElementStates.push({
            id,
            paused: audio?.paused,
            currentTime: audio?.currentTime?.toFixed(2),
            connected: analyserData.connected
          });
        }
        
        const debugMsg = `Playing: ${playingCount}/${audioElements.size} | RMS: ${rms.toFixed(3)} | dB: ${db.toFixed(1)}`;
        setDebugInfo(debugMsg);
        
        // Log audio element states periodically
        if (frameCount % 120 === 0) {
        //   console.log('🔍 VolumeBar: Audio element states:', audioElementStates);
        }
        
      } catch (error) {
        console.warn('❌ Error analyzing audio levels:', error);
      }
      
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };
    
    updateLevels();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, audioElements, isSupported]);
  
  // Calculate RMS level from time domain data (more accurate for level meters)
  const calculateRMSFromTimeDomain = (data) => {
    let sum = 0;
    let samples = 0;
    
    for (let i = 0; i < data.length; i++) {
      // Convert from unsigned 8-bit to signed float (-1 to 1)
      const sample = (data[i] - 128) / 128;
      sum += sample * sample;
      samples++;
    }
    
    if (samples === 0) return 0;
    
    const rms = Math.sqrt(sum / samples);
    return rms;
  };
  
  // Render volume meter
  const renderMeter = () => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    if (!isSupported) {
      // Show "not supported" message
      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Audio Analysis', width / 2, height / 2 - 5);
      ctx.fillText('Not Supported', width / 2, height / 2 + 10);
      return;
    }
    
    // Meter dimensions
    const meterWidth = 18;
    const meterHeight = height - 50;
    const meterStartY = 25;
    const leftMeterX = 10;
    const rightMeterX = leftMeterX + meterWidth + 6;
    
    // Draw meter backgrounds
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(leftMeterX, meterStartY, meterWidth, meterHeight);
    ctx.fillRect(rightMeterX, meterStartY, meterWidth, meterHeight);
    
    // Draw level bars with gradient effect
    const drawLevelBar = (x, level, peak) => {
      // Convert dB to pixel position (6dB at top, -60dB at bottom)
      const dbRange = 66; // 6dB to -60dB = 66dB range
      const levelHeight = Math.max(0, (level + 60) / dbRange * meterHeight);
      const peakHeight = Math.max(0, (peak + 60) / dbRange * meterHeight);
      
      if (levelHeight <= 0) return; // No signal
      
      // Create gradient for level bar
      const gradient = ctx.createLinearGradient(0, meterStartY, 0, meterStartY + meterHeight);
      gradient.addColorStop(0, '#ff4444'); // Red at top (6dB)
      gradient.addColorStop(0.1, '#ff6600'); // Orange
      gradient.addColorStop(0.3, '#ffaa00'); // Yellow
      gradient.addColorStop(0.7, '#88ff44'); // Light green
      gradient.addColorStop(1, '#44ff44'); // Green at bottom (-60dB)
      
      // Draw level bar
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, meterStartY + meterHeight - levelHeight, meterWidth, levelHeight);
      ctx.clip();
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, meterStartY, meterWidth, meterHeight);
      ctx.restore();
      
      // Draw peak indicator
      if (peak > -60) {
        ctx.fillStyle = peak > -3 ? '#ff4444' : peak > -12 ? '#ffaa00' : '#44ff44';
        const peakY = meterStartY + meterHeight - peakHeight;
        ctx.fillRect(x, peakY - 1, meterWidth, 2);
      }
      
      // Draw clipping indicator
      if (level > 0) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(x, meterStartY, meterWidth, 4);
      }
    };
    
    drawLevelBar(leftMeterX, levels.left, peakLevels.left);
    drawLevelBar(rightMeterX, levels.right, peakLevels.right);
    
    // Draw scale markings
    ctx.fillStyle = '#555';
    ctx.font = '7px monospace';
    ctx.textAlign = 'right';
    
    const scaleMarks = [6, 0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60];
    scaleMarks.forEach(db => {
      const dbRange = 66; // 6dB to -60dB
      const y = meterStartY + ((6 - db) / dbRange * meterHeight);
      
      // Different colors for different ranges
      if (db >= 0) {
        ctx.fillStyle = '#ff4444'; // Red zone (clipping)
      } else if (db >= -6) {
        ctx.fillStyle = '#ff6666'; // Light red zone
      } else if (db >= -18) {
        ctx.fillStyle = '#ffaa44'; // Orange zone  
      } else {
        ctx.fillStyle = '#555'; // Normal zone
      }
      
      ctx.fillText(db.toString(), 8, y + 2);
      
      // Draw tick marks
      ctx.fillStyle = '#444';
      ctx.fillRect(leftMeterX - 2, y, 2, 1);
      ctx.fillRect(rightMeterX + meterWidth, y, 2, 1);
    });
    
    // Draw channel labels
    ctx.fillStyle = '#888';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('L', leftMeterX + meterWidth / 2, height - 18);
    ctx.fillText('R', rightMeterX + meterWidth / 2, height - 18);
  };
  
  // Render to canvas
  useEffect(() => {
    renderMeter();
  }, [levels, peakLevels, isSupported, debugInfo]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up audio nodes but DON'T close the audio context
      // Closing the context causes the "closed" state issue
      if (masterAnalyser.current) {
        try {
          masterAnalyser.current.disconnect();
        } catch (error) {
          console.warn('Error disconnecting master analyser:', error);
        }
      }
      
      if (masterGainNode.current) {
        try {
          masterGainNode.current.disconnect();
        } catch (error) {
          console.warn('Error disconnecting master gain:', error);
        }
      }
      
      // Clean up individual sources
      for (const [id, analyserData] of analyserNodes.current.entries()) {
        if (analyserData.source) {
          try {
            analyserData.source.disconnect();
          } catch (error) {
            console.warn('Error disconnecting audio source:', error);
          }
        }
      }
      
      // Cancel animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // DON'T close the audio context - let the browser manage it
      // This prevents the "closed" state issue
    //   console.log('🧹 VolumeBar cleanup complete (audio context left open)');
    };
  }, []);
  
  return (
    <div style={{
      width: '80px',
      minWidth: '80px',
      maxWidth: '80px',
      height: '100%',
      background: 'linear-gradient(to bottom, #2a2a2a, #1e1e1e)', // Gradient background to match timeline
      border: '1px solid #333', // Proper border
      borderLeft: '1px solid #444', // Slightly lighter left border
      borderRadius: '0 8px 8px 0', // Rounded right corners to match timeline
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 8px 8px 8px', // More top padding
      flexShrink: 0,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' // Subtle inner highlight
    }}>
      <div style={{
        fontSize: '10px',
        color: '#888',
        marginBottom: '12px',
        fontWeight: '600',
        textAlign: 'center',
        letterSpacing: '0.5px',
        textTransform: 'uppercase'
      }}>
        Audio Meter
      </div>
      
      <canvas
        ref={canvasRef}
        width={64}
        height={220} // Slightly taller canvas
        style={{
          width: '64px',
          height: '220px',
          imageRendering: 'crisp-edges',
          borderRadius: '3px',
          background: '#111', // Dark canvas background
          border: '1px solid #444'
        }}
      />
      
      {/* {isSupported && (
        <div style={{
          fontSize: '8px',
          color: '#666',
          marginTop: '8px',
          textAlign: 'center',
          fontFamily: 'monospace',
          lineHeight: '1.3',
          background: 'rgba(0,0,0,0.3)',
          padding: '4px 6px',
          borderRadius: '3px',
          border: '1px solid #333'
        }}>
          L: {levels.left.toFixed(1)}dB<br/>
          R: {levels.right.toFixed(1)}dB
        </div>
      )} */}
    </div>
  );
};

export default VolumeBar; 