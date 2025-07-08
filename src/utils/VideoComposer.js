import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MediaProcessor } from './MediaProcessor';

export class VideoComposer {
  constructor() {
    this.ffmpeg = null;
    this.initialized = false;
    this.mediaProcessor = new MediaProcessor();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.ffmpeg = new FFmpeg();
      
      // Load FFmpeg with WASM
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      this.initialized = true;
      console.log('✅ FFmpeg initialized successfully');
    } catch (error) {
      console.error('Failed to initialize FFmpeg:', error);
      throw new Error('Failed to initialize video encoder');
    }
  }

  async exportVideo({ mediaItems, duration, width = 1920, height = 1080, fps = 15, onProgress, onTimelineSeek }) {
    try {
      // Ensure onProgress is callable
      const safeOnProgress = typeof onProgress === 'function' ? onProgress : () => {};
      
      // Validate input parameters
      if (!duration || duration <= 0) {
        throw new Error('Duration must be a positive number');
      }
      if (!fps || fps <= 0) {
        throw new Error('FPS must be a positive number');
      }
      if (!mediaItems || mediaItems.length === 0) {
        throw new Error('No media items to export');
      }
      if (!onTimelineSeek || typeof onTimelineSeek !== 'function') {
        throw new Error('Timeline seek callback is required for canvas capture export');
      }
      
      // Separate audio and visual items
      const audioItems = mediaItems.filter(item => item.type === 'audio');
      const videoItems = mediaItems.filter(item => item.type === 'video');
      const visualItems = mediaItems.filter(item => item.type !== 'audio');
      
      // Start with basic audio items, then add virtual audio from video files below
      const allAudioSources = [...audioItems];
      
      // FIXED: Only extract audio from video files if there's NO separate audio track already
      // This prevents double audio inclusion for MP4s that have separate audio tracks
      videoItems.forEach(videoItem => {
        // Check if there's already a separate audio item for this video
        // Look for both explicit video audio tracks AND source-linked audio tracks
        const hasExistingAudioTrack = 
          // Check if video item is explicitly marked as having an audio track
          videoItem.hasAudioTrack ||
          // Check if there's a separate audio item for this video
          audioItems.some(audioItem => 
            (audioItem.isVideoAudio && audioItem.sourceVideoId === videoItem.id) ||
            (audioItem.sourceVideoId === videoItem.sourceId) ||
            (audioItem.sourceId === videoItem.sourceId && audioItem.type === 'audio') ||
            (audioItem.audioTrackId === videoItem.id) ||
            // Check if audio item name matches video name pattern (fallback detection)
            (audioItem.name && videoItem.name && 
             audioItem.name.includes(videoItem.name.replace(/\.[^/.]+$/, '')) && 
             audioItem.name.includes('Audio'))
          );
        
        if (!hasExistingAudioTrack) {
          // Create a virtual audio item for the video's audio track
          const videoAudioItem = {
            ...videoItem,
            id: `${videoItem.id}_audio`, // Unique ID for the audio track
            name: `${videoItem.name} (Audio)`,
            type: 'audio', // Mark as audio for processing
            isVideoAudio: true, // Flag to indicate this is from a video file
            originalVideoItem: videoItem // Keep reference to original video item
          };
          allAudioSources.push(videoAudioItem);
          console.log('📹 Creating virtual audio track for video:', videoItem.name);
        } else {
          console.log('⏭️ Skipping virtual audio track for video (separate track exists):', videoItem.name, 'hasAudioTrack:', videoItem.hasAudioTrack);
        }
      });

      // FIXED: Calculate exact export duration based on the last media item end time
      // This prevents blank frames and creates perfect loops
      // Include ALL media items: original mediaItems + virtual video audio items
      const allMediaForDuration = [...mediaItems, ...allAudioSources.filter(item => item.isVideoAudio)];
      let actualDuration = 0; // Start from zero instead of timeline duration
      
      // Find the latest end time from ALL media items (visual + audio + virtual video audio)
      if (allMediaForDuration.length > 0) {
        const allMediaEndTimes = allMediaForDuration.map(item => item.startTime + item.duration);
        actualDuration = Math.max(...allMediaEndTimes);
        
        console.log('📏 Perfect Loop Duration Calculation:', {
          originalTimelineDuration: duration,
          totalMediaItems: allMediaForDuration.length,
          originalMediaItems: mediaItems.length,
          virtualVideoAudioItems: allAudioSources.filter(item => item.isVideoAudio).length,
          mediaEndTimes: allMediaEndTimes,
          actualDuration: actualDuration,
          savedTime: (duration - actualDuration).toFixed(2) + 's (no blank frames!)'
        });
      } else {
        // Fallback to original duration if no media items
        actualDuration = duration;
        console.log('📏 No media items found, using timeline duration:', actualDuration);
      }

      console.log('🎬 Starting 3-Step Export Process:', {
        totalItems: mediaItems.length,
        audioItems: audioItems.length,
        videoItems: videoItems.length,
        videoAudioTracks: videoItems.length, // Video files that contribute audio
        totalAudioSources: allAudioSources.length, // All audio sources including video audio
        visualItems: visualItems.length,
        originalDuration: duration,
        actualDuration: actualDuration,
        dimensions: `${width}x${height}`,
        fps
      });

      // STEP 1: Canvas Capture → Video
      console.log('📹 STEP 1: Capturing video from canvas...');
      const videoBlob = await this.captureCanvasVideo({ 
        width, height, fps, duration: actualDuration, onTimelineSeek, onProgress: (progress, status) => {
          safeOnProgress(progress * 0.6, status); // 0-60% for video capture
        }
      });
      
      console.log('✅ STEP 1 Complete - Video captured:', videoBlob.size, 'bytes');

      // STEP 2: Audio Mixing → Single Audio Track  
      let finalAudioBlob = null;
      if (allAudioSources.length > 0) {
        console.log('🎵 STEP 2: Mixing audio tracks...');
        finalAudioBlob = await this.mixAudioTracks(allAudioSources, actualDuration, (progress, status) => {
          safeOnProgress(60 + progress * 0.3, status); // 60-90% for audio mixing
        });
        console.log('✅ STEP 2 Complete - Audio mixed:', finalAudioBlob?.size || 0, 'bytes');
      } else {
        console.log('⏭️ STEP 2 Skipped - No audio tracks found');
      }

      // STEP 3: Final Combination → Video + Audio
      console.log('🎬 STEP 3: Combining video and audio...');
      const finalBlob = await this.combineVideoAndAudio(videoBlob, finalAudioBlob, actualDuration, (progress, status) => {
        safeOnProgress(90 + progress * 0.1, status); // 90-100% for final combination
      });
      
      console.log('✅ STEP 3 Complete - Final export:', finalBlob.size, 'bytes');

      safeOnProgress(100, 'Export complete! 🎉');
      const url = URL.createObjectURL(finalBlob);
      console.log('🎉 3-Step Export Process Completed Successfully!');
      
      return { url, blob: finalBlob };

    } catch (error) {
      console.error('❌ Export process failed:', error);
      throw error;
    }
  }

  // STEP 1: Canvas Capture (extracted from existing code)
  async captureCanvasVideo({ width, height, fps, duration, onTimelineSeek, onProgress }) {
    // Find the existing canvas element from VideoCanvas component
    const existingCanvas = document.querySelector('canvas.video-canvas');
    if (!existingCanvas) {
      throw new Error('No canvas found. Please ensure the video preview is visible during export.');
    }

    // Create a new canvas for recording at exact export dimensions
    const recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = width;
    recordingCanvas.height = height;
    const ctx = recordingCanvas.getContext('2d');

    // Setup MediaRecorder with high quality settings
    const stream = recordingCanvas.captureStream(fps);
    
    // Try VP8 first for better transparency support
    let mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp9';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 8000000 // 8 Mbps for high quality
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const videoBlob = new Blob(chunks, { type: 'video/webm' });
        if (videoBlob.size === 0) {
          reject(new Error('Canvas capture produced empty video'));
        } else {
          resolve(videoBlob);
        }
      };

      recorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        reject(error);
      };

      // Start recording
      recorder.start();

      let frameIndex = 0;
      const totalFrames = Math.max(1, Math.ceil(duration * fps));
      const timeStep = 1 / fps;

      const renderFrame = async () => {
        if (frameIndex >= totalFrames) {
          recorder.stop();
          return;
        }

        const currentTime = frameIndex * timeStep;
        const frameProgress = (frameIndex / totalFrames) * 100;
        
        onProgress(frameProgress, `Capturing frame ${frameIndex + 1}/${totalFrames} (${currentTime.toFixed(1)}s)`);
        
        // Use the callback to seek the timeline to the exact time
        // This handles both video content and extended audio-only sections
        await onTimelineSeek(currentTime);
        
        // Wait two animation frames to ensure canvas has rendered the new content
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // Clear recording canvas to transparent background for VP8 transparency support
        ctx.clearRect(0, 0, width, height);
        
        // Scale and draw the existing canvas onto our recording canvas
        const sourceWidth = existingCanvas.width;
        const sourceHeight = existingCanvas.height;
          
        // Calculate scaling to fit the export dimensions while maintaining aspect ratio
        const scaleX = width / sourceWidth;
        const scaleY = height / sourceHeight;
        const scale = Math.min(scaleX, scaleY);
        
        const scaledWidth = sourceWidth * scale;
        const scaledHeight = sourceHeight * scale;
            
        // Center the scaled canvas
        const offsetX = (width - scaledWidth) / 2;
        const offsetY = (height - scaledHeight) / 2;

        // Draw the canvas content (preserves transparency with VP8)
        ctx.drawImage(existingCanvas, offsetX, offsetY, scaledWidth, scaledHeight);

        frameIndex++;
        
        // FIXED: Proper frame timing to match target FPS
        // Use requestAnimationFrame with proper timing instead of immediate recursion
        const targetFrameTime = 1000 / fps; // Time per frame in milliseconds
        const nextFrameTime = frameIndex * targetFrameTime;
        const elapsedTime = performance.now() - startTime;
        const delay = Math.max(0, nextFrameTime - elapsedTime);
        
        setTimeout(() => {
          renderFrame();
        }, delay);
      };

      // Track start time for proper timing
      const startTime = performance.now();
      
      // Start the frame capture process
      renderFrame();
    });
  }

  // STEP 2: Mix all audio tracks into a single audio file
  async mixAudioTracks(audioItems, totalDuration, onProgress) {
    try {
      await this.initialize();
      
      console.log('🎵 === STEP 2: PROPER MULTI-TRACK AUDIO MIXING ===');
      console.log('🎵 Processing', audioItems.length, 'audio tracks for', totalDuration, 'seconds');
      console.log('🎵 Audio details:', audioItems.map(item => ({
        name: item.name,
        startTime: item.startTime,
        duration: item.duration,
        fileSize: item.file?.size,
        fileType: item.file?.type
      })));
      
      // PATCH FIXES APPLIED:
      // ✅ Patch 1: No silent base + asetpts=PTS-STARTPTS + duration=longest + direct WebM output
      // ✅ Patch 2: Copy streams instead of re-encoding (applied in combineVideoAndAudio)
      // 🔍 Quick checklist: mixed_audio.webm should have proper duration and be audible when played alone
      
      if (audioItems.length === 0) {
        console.log('❌ No audio items to process');
        return null;
      }
      
      onProgress(20, 'Preparing audio files...');
      
      // Prepare all audio files
      const audioFiles = [];
      for (let i = 0; i < audioItems.length; i++) {
        const audioItem = audioItems[i];
        const audioFileName = `audio_${i}.mp3`;
        
        try {
          console.log(`🔍 Processing audio item ${i}:`, audioItem.name);
          
          let audioBlob;
          if (audioItem.file && audioItem.file instanceof File) {
            audioBlob = audioItem.file;
            console.log(`📁 Using File object: ${audioItem.file.type}, ${audioItem.file.size} bytes`);
          } else if (audioItem.url) {
            console.log(`🌐 Fetching from URL: ${audioItem.url}`);
            const response = await fetch(audioItem.url);
            audioBlob = await response.blob();
            console.log(`✅ Fetched: ${audioBlob.type}, ${audioBlob.size} bytes`);
          } else {
            console.warn('❌ Skipping audio item with no valid source:', audioItem.name);
            continue;
          }
          
          // For video audio items, we need to extract just the audio track
          if (audioItem.isVideoAudio) {
            console.log(`🎬 Extracting audio from video file: ${audioItem.name}`);
            
            // Write the video file temporarily
            const tempVideoFile = `temp_video_${i}.mp4`;
            await this.ffmpeg.writeFile(tempVideoFile, await fetchFile(audioBlob));
            
            // Extract audio track from video file
            const extractedAudioFile = `extracted_audio_${i}.mp3`;
            await this.ffmpeg.exec([
              '-i', tempVideoFile,
              '-vn', // No video
              '-acodec', 'mp3',
              '-ab', '192k',
              '-y',
              extractedAudioFile
            ]);
            
            // Read the extracted audio
            const extractedAudioData = await this.ffmpeg.readFile(extractedAudioFile);
            audioBlob = new Blob([extractedAudioData.buffer], { type: 'audio/mp3' });
            
            // Clean up temporary files
            await this.ffmpeg.deleteFile(tempVideoFile);
            await this.ffmpeg.deleteFile(extractedAudioFile);
            
            console.log(`✅ Audio extracted from video: ${audioBlob.size} bytes`);
          }
          
          await this.ffmpeg.writeFile(audioFileName, await fetchFile(audioBlob));
          
          audioFiles.push({
            fileName: audioFileName,
            startTime: audioItem.startTime,
            duration: audioItem.duration,
            name: audioItem.name,
            originalSize: audioBlob.size
          });
          
          console.log(`✅ Prepared: ${audioItem.name} (${audioItem.startTime}s - ${audioItem.startTime + audioItem.duration}s)`);
        } catch (error) {
          console.error(`❌ Failed to prepare ${audioItem.name}:`, error);
          continue;
        }
      }
      
      if (audioFiles.length === 0) {
        console.log('❌ No valid audio files to mix');
        return null;
      }
      
      console.log(`📊 Successfully prepared ${audioFiles.length} audio files`);
      
      onProgress(40, 'Building proper filter graph...');
      
      // PATCH 1: Build filter graph properly without silent base
      // No more silent_base.ogg - each track is padded individually
      
      // For single audio starting at 0, still use simple approach for efficiency
      if (audioFiles.length === 1 && audioFiles[0].startTime === 0) {
        console.log('🎵 Single audio at time 0 - returning directly in WebM format');
        
        // Convert single audio to WebM format directly
        await this.ffmpeg.exec([
          '-i', audioFiles[0].fileName,
          '-c:a', 'libvorbis',
          '-b:a', '192k',
          '-t', totalDuration.toString(),
          '-y',
          'mixed_audio.webm'
        ]);
        
        const singleAudioData = await this.ffmpeg.readFile('mixed_audio.webm');
        const audioBlob = new Blob([singleAudioData.buffer], { type: 'video/webm' });
        
        // Immediate cleanup
        await this.cleanupAudioFiles(['mixed_audio.webm', ...audioFiles.map(f => f.fileName)]);
        
        console.log(`✅ Single audio converted to WebM: ${audioBlob.size} bytes`);
        return audioBlob;
      }
      
      onProgress(60, 'Mixing multiple tracks with proper timing...');
      
      // PATCH 1: Proper multi-track mixing without silent base
      const inputs = [];
      const filterParts = [];
      
      audioFiles.forEach((f, i) => {
        inputs.push('-i', f.fileName); // Add each clip as an input
        const delayMs = Math.round(f.startTime * 1000);
        const lbl = `a${i}`;
        
        let filterPart = `[${i}:a]` +
          `atrim=duration=${f.duration},` +           // Cut to length
          `asetpts=PTS-STARTPTS,` +                   // Reset PTS (fixes timestamp issues)
          (delayMs ? `adelay=${delayMs}|${delayMs},` : '') +
          `apad` +                                    // Pad with silence so all tracks reach totalDuration
          `[${lbl}]`;
          
        filterParts.push(filterPart);
      });
      
      // Glue the individual streams together with duration=longest
      const mixFilter = 
        filterParts.join(';') +
        ';' +
        filterParts.map((_, i) => `[a${i}]`).join('') +
        `amix=inputs=${audioFiles.length}:duration=longest:dropout_transition=0[m]`;
      
      console.log('🎛️ Proper audio mix filter:', mixFilter);
      
      // Execute mixing directly to WebM format
      const mixCommand = [
        ...inputs,
        '-filter_complex', mixFilter,
        '-map', '[m]',
        '-c:a', 'libvorbis', // Vorbis keeps the stack small
        '-b:a', '192k',
        '-t', totalDuration.toString(),
        '-y',
        'mixed_audio.webm' // Write directly to WebM format!
      ];
      
      console.log('🎛️ Mix command:', mixCommand.join(' '));
      await this.ffmpeg.exec(mixCommand);
      
      onProgress(80, 'Reading mixed audio...');
      
      // Read and immediately cleanup
      const audioData = await this.ffmpeg.readFile('mixed_audio.webm');
      console.log(`✅ Mixed audio read: ${audioData.byteLength} bytes`);
      
      // Immediate cleanup
      await this.cleanupAudioFiles(['mixed_audio.webm', ...audioFiles.map(f => f.fileName)]);
      
      const audioBlob = new Blob([audioData.buffer.slice(0, audioData.byteLength)], { type: 'video/webm' });
      
      onProgress(100, 'Multi-track audio mixing complete');
      console.log('✅ Multi-track audio mixing successful, final size:', audioBlob.size, 'bytes');
      console.log('🎵 === END STEP 2: PROPER FILTER GRAPH SUCCESS ===');
      
      return audioBlob;
      
    } catch (error) {
      console.error('❌ === STEP 2 MULTI-TRACK FAILED ===');
      console.error('❌ Error:', error);
      
      // Cleanup on error
      await this.cleanupAudioFiles(['mixed_audio.webm']);
      for (let i = 0; i < audioItems.length; i++) {
        await this.cleanupAudioFiles([`audio_${i}.mp3`]);
        // Clean up potential video audio extraction files
        await this.cleanupAudioFiles([`temp_video_${i}.mp4`, `extracted_audio_${i}.mp3`]);
      }
      
      return null; // Return null to allow video-only export
    }
  }

  // STEP 3: Combine video and mixed audio into final export
  async combineVideoAndAudio(videoBlob, audioBlob, duration, onProgress) {
    try {
      await this.initialize();
      
      console.log('🎬 === STEP 3: VIDEO/AUDIO COMBINATION DEBUG ===');
      console.log('📊 Input video size:', videoBlob?.size || 0, 'bytes');
      console.log('📊 Input audio size:', audioBlob?.size || 0, 'bytes');
      console.log('📊 Target duration:', duration, 'seconds');
      
      onProgress(20, 'Writing video file...');
      console.log('📝 Writing video to FFmpeg filesystem...');
      
      try {
        await this.ffmpeg.writeFile('video.webm', await fetchFile(videoBlob));
        
        // Verify video file
        const writtenVideoData = await this.ffmpeg.readFile('video.webm');
        console.log(`✅ Video written and verified: ${writtenVideoData.byteLength} bytes`);
        
        if (writtenVideoData.byteLength !== videoBlob.size) {
          console.warn(`⚠️ Video size mismatch: expected ${videoBlob.size}, got ${writtenVideoData.byteLength}`);
        }
      } catch (videoWriteError) {
        console.error('❌ Failed to write/verify video file:', videoWriteError);
        throw videoWriteError;
      }
      
      if (!audioBlob) {
        // No audio - just return the video
        console.log('📹 No audio provided - returning video-only');
        onProgress(100, 'Video-only export complete');
        return videoBlob;
      }
      
      // Validate audioBlob before processing
      if (!audioBlob.size || audioBlob.size === 0) {
        console.warn('⚠️ Audio blob is empty or invalid - returning video-only');
        onProgress(100, 'Video-only export (invalid audio)');
        return videoBlob;
      }
      
      console.log('✅ Audio blob validation passed:', {
        size: audioBlob.size,
        type: audioBlob.type || 'undefined',
        hasBlob: audioBlob instanceof Blob
      });
      
      onProgress(40, 'Writing audio file...');
      console.log('📝 Writing audio to FFmpeg filesystem...');
      
      try {
        // Safely determine audio format with fallbacks
        let audioFileName = 'audio.webm'; // Default to WebM since our mixing produces WebM
        
        if (audioBlob.type) {
          // Check if we have a type property
          if (audioBlob.type.includes('webm') || audioBlob.type.includes('video/webm')) {
            audioFileName = 'audio.webm';
          } else if (audioBlob.type.includes('ogg') || audioBlob.type.includes('vorbis')) {
            audioFileName = 'audio.ogg';
          } else if (audioBlob.type.includes('mp3') || audioBlob.type.includes('mpeg')) {
            audioFileName = 'audio.mp3';
          } else if (audioBlob.type.includes('wav')) {
            audioFileName = 'audio.wav';
          } else {
            // Unknown audio type, but our mixing produces WebM
            console.log('⚠️ Unknown audio type:', audioBlob.type, '- defaulting to WebM (from mixing)');
            audioFileName = 'audio.webm';
          }
        } else {
          console.log('⚠️ Audio blob has no type property - defaulting to WebM (from mixing)');
          audioFileName = 'audio.webm'; // Default to WebM since our mixing produces WebM
        }
        
        console.log('📊 Audio blob details:', {
          size: audioBlob.size,
          type: audioBlob.type || 'undefined',
          fileName: audioFileName
        });
        
        await this.ffmpeg.writeFile(audioFileName, await fetchFile(audioBlob));
        
        // Verify audio file
        const writtenAudioData = await this.ffmpeg.readFile(audioFileName);
        console.log(`✅ Audio written and verified: ${audioFileName}, ${writtenAudioData.byteLength} bytes`);
        
        if (writtenAudioData.byteLength !== audioBlob.size) {
          console.warn(`⚠️ Audio size mismatch: expected ${audioBlob.size}, got ${writtenAudioData.byteLength}`);
        }
        
        onProgress(60, 'Combining video and audio...');
        console.log('🎬 Starting video/audio combination...');
        
        // PATCH 2: Mux without re-encoding - both inputs are WebM compatible
        // VP9 video + Vorbis audio = just metadata pass-through, minimal memory usage
        const combineCommand = [
          '-i', 'video.webm',
          '-i', audioFileName,
          '-c:v', 'copy', // Copy video stream as-is 
          '-c:a', 'copy', // Copy audio stream as-is (NO re-encoding, NO stack stress!)
          '-map', '0:v:0', // Explicitly map first video stream
          '-map', '1:a:0', // Explicitly map first audio stream  
          '-shortest', // End when shortest stream ends
          '-t', duration.toString(), // Use full calculated duration
          '-avoid_negative_ts', 'make_zero', // Handle timing issues
          '-y',
          'final.webm'
        ];
        
        console.log('🎛️ Combination command:', combineCommand.join(' '));
        console.log('🔄 Executing combination (this is where the error likely occurs)...');
        
        await this.ffmpeg.exec(combineCommand);
        
        console.log('✅ Combination command completed successfully');
        
        onProgress(80, 'Reading final export...');
        
        const finalData = await this.ffmpeg.readFile('final.webm');
        console.log(`✅ Final export read: ${finalData.byteLength} bytes`);
        
        // Immediate cleanup after reading (frees memory sooner)
        try {
          await this.ffmpeg.deleteFile('video.webm');
          await this.ffmpeg.deleteFile(audioFileName);
          await this.ffmpeg.deleteFile('final.webm');
          console.log('🧹 Immediate cleanup completed');
        } catch (cleanupError) {
          console.warn('⚠️ Immediate cleanup warning:', cleanupError);
        }
        
        const finalBlob = new Blob([finalData.buffer.slice(0, finalData.byteLength)], { type: 'video/webm' });
        
        // No additional cleanup needed - already done above
        
        onProgress(100, 'Export complete');
        console.log('✅ Final combination successful, size:', finalBlob.size, 'bytes');
        console.log('🎬 === END STEP 3: ZERO RE-ENCODING SUCCESS ===');
        
        return finalBlob;
        
      } catch (audioWriteError) {
        console.error('❌ Failed to write/verify audio file:', audioWriteError);
        throw audioWriteError;
      }
      
    } catch (error) {
      console.error('❌ === STEP 3 FAILED ===');
      console.error('❌ Video/audio combination error details:', error);
      console.error('❌ Error type:', error.constructor.name);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
      
      // Enhanced error analysis
      if (error.message.includes('memory') || error.message.includes('out of bounds')) {
        console.error('🚨 MEMORY ERROR DETECTED:');
        console.error('   - This suggests FFmpeg WASM ran out of memory');
        console.error('   - Video size:', videoBlob?.size || 0, 'bytes');
        console.error('   - Audio size:', audioBlob?.size || 0, 'bytes');
        console.error('   - Combined size:', (videoBlob?.size || 0) + (audioBlob?.size || 0), 'bytes');
        console.error('   - Try reducing video length or audio quality');
      }
      
      // Clean up on error
      await this.cleanupAudioFiles(['video.webm', 'audio.webm', 'audio.ogg', 'audio.mp3', 'audio.wav', 'final.webm']);
      
      // If combination fails, return video-only as fallback
      console.warn('🔄 Falling back to video-only export due to combination failure');
      return videoBlob;
    }
  }

  // Helper method for cleanup
  async cleanupAudioFiles(filenames) {
    for (const filename of filenames) {
      try {
        await this.ffmpeg.deleteFile(filename);
      } catch (cleanupError) {
        // Ignore cleanup errors
        console.warn('Could not delete file:', filename);
      }
    }
  }

  // LEGACY: Keep the old method for backward compatibility (but mark as deprecated)
  async addAudioToVideo(videoBlob, audioItem, duration) {
    try {
      await this.initialize();
      
      // Write video file
      await this.ffmpeg.writeFile('video.webm', await fetchFile(videoBlob));
      
      // Write audio file
      const audioResponse = await fetch(audioItem.url);
      const audioBlob = await audioResponse.blob();
      await this.ffmpeg.writeFile('audio.mp3', await fetchFile(audioBlob));
      
      // Combine video and audio
      await this.ffmpeg.exec([
        '-i', 'video.webm',
        '-i', 'audio.mp3',
        '-c:v', 'copy',
        '-c:a', 'libopus',
        '-shortest',
        '-t', duration.toString(),
        '-y',
        'output.webm'
      ]);
      
      // Read the result
      const data = await this.ffmpeg.readFile('output.webm');
      const resultBlob = new Blob([data.buffer], { type: 'video/webm' });
      
      // Cleanup
      try {
        await this.ffmpeg.deleteFile('video.webm');
        await this.ffmpeg.deleteFile('audio.mp3');
        await this.ffmpeg.deleteFile('output.webm');
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError);
      }
      
      return resultBlob;
    } catch (error) {
      console.warn('Failed to add audio with FFmpeg:', error);
      // Return original video if audio mixing fails
      return videoBlob;
    }
  }

  // Fallback export using same Canvas capture method
  async exportVideoFallback({ mediaItems, duration, width = 1920, height = 1080, fps = 15, onProgress, onTimelineSeek }) {
    // The fallback now uses the same canvas capture approach for consistency
    // This ensures both methods produce identical results
    return this.exportVideo({ mediaItems, duration, width, height, fps, onProgress, onTimelineSeek });
  }
} 