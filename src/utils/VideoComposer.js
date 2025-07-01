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

  async exportVideo({ mediaItems, duration, width = 1920, height = 1080, fps = 15, onProgress }) {
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
      
      safeOnProgress(5, 'Processing media items...');

      // Filter out audio items for video processing
      const visualMediaItems = mediaItems.filter(item => item.type !== 'audio');
      const audioItems = mediaItems.filter(item => item.type === 'audio');

      console.log('🎬 Starting Canvas-based export:', {
        totalItems: mediaItems.length,
        visualItems: visualMediaItems.length,
        audioItems: audioItems.length,
        duration,
        dimensions: `${width}x${height}`,
        fps
      });

      // Process all media items and extract their frames
      const mediaProcessors = new Map();
      safeOnProgress(10, 'Analyzing media files...');
      
      for (let i = 0; i < visualMediaItems.length; i++) {
        const item = visualMediaItems[i];
        const progressBase = visualMediaItems.length > 0 ? (i / visualMediaItems.length) * 15 : 0; // Reduced from 20 to 15
        safeOnProgress(10 + progressBase, `Processing ${item.name}... (${i + 1}/${visualMediaItems.length})`);
        
        try {
          const frameData = await this.mediaProcessor.extractFrames(item, (progress, status) => {
            const itemProgress = visualMediaItems.length > 0 ? (progress / 100) * (15 / visualMediaItems.length) : 0; // Reduced from 20 to 15
            safeOnProgress(10 + progressBase + itemProgress, 
                      `${item.name}: ${status}`);
          });
          
          const processor = this.mediaProcessor.createProcessor(item, frameData);
          mediaProcessors.set(item.id, processor);
          console.log(`✅ Processed ${item.name}: ${frameData.frameCount} frames, ${frameData.duration}s`);
        } catch (error) {
          console.error(`❌ Failed to process ${item.name}:`, error);
          // Continue with other items
        }
      }

      safeOnProgress(25, 'Media processing complete. Setting up video recording...');

      // Create canvas for recording
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      safeOnProgress(27, 'Configuring video encoder...');

      // Setup MediaRecorder with high quality settings
      const stream = canvas.captureStream(fps);
      
      // Try different codec options for best quality
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8000000 // 8 Mbps for high quality
      });

      safeOnProgress(29, `Using ${mimeType} codec for recording...`);

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      return new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          try {
            safeOnProgress(87, 'Video recording complete. Processing final video...');
            let finalBlob = new Blob(chunks, { type: 'video/webm' });
            
            // If we have audio, we need to mix it with the video
            if (audioItems.length > 0) {
              safeOnProgress(90, 'Adding audio track...');
              try {
                finalBlob = await this.addAudioToVideo(finalBlob, audioItems[0], duration);
                safeOnProgress(95, 'Audio mixing complete...');
              } catch (audioError) {
                console.warn('Failed to add audio, proceeding with video only:', audioError);
                safeOnProgress(95, 'Audio mixing failed, proceeding with video only...');
              }
            } else {
              safeOnProgress(95, 'No audio to process...');
            }
            
            safeOnProgress(98, 'Creating download link...');
            const url = URL.createObjectURL(finalBlob);
            safeOnProgress(100, 'Export complete! 🎉');
            console.log('✅ Canvas-based export completed successfully');
            resolve({ url, blob: finalBlob });
          } catch (error) {
            reject(error);
          }
        };

        recorder.onerror = (error) => {
          console.error('MediaRecorder error:', error);
          reject(error);
        };

        // Start recording
        recorder.start();
        safeOnProgress(30, 'Recording video frames...');

        let frameIndex = 0;
        const totalFrames = Math.max(1, Math.ceil(duration * fps)); // Ensure at least 1 frame
        const timeStep = 1 / fps;
        let startTime = Date.now();
        let lastProgressUpdate = 0; // Track last progress percentage to throttle updates

        const renderFrame = async () => {
          if (frameIndex >= totalFrames) {
            recorder.stop();
            safeOnProgress(85, 'Finalizing video...');
            return;
          }

          const currentTime = frameIndex * timeStep;
          
          // Clear canvas with transparent background
          ctx.clearRect(0, 0, width, height);
          
          // Get active visual items at current time
          const activeItems = visualMediaItems.filter(item => 
            currentTime >= item.startTime && 
            currentTime < item.startTime + item.duration
          );

          // Render each active item using the frame-based system
          for (const item of activeItems) {
            const processor = mediaProcessors.get(item.id);
            if (!processor) continue;

            const relativeTime = currentTime - item.startTime;
            
            // Check if media should be visible at this time
            if (!processor.isVisibleAtTime(relativeTime)) continue;
            
            try {
              const frame = processor.getCurrentFrame(relativeTime);
              if (!frame) continue;

              // Create image from frame
              const img = new Image();
              img.crossOrigin = 'anonymous';
              
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Image load timeout')), 2000);
                img.onload = () => {
                  clearTimeout(timeout);
                  resolve();
                };
                img.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error('Image load failed'));
                };
                img.src = frame.url;
              });

              // Apply transformations and render
              ctx.save();
              
              // Set opacity
              ctx.globalAlpha = item.opacity || 1;
              
              // Apply transformations
              const centerX = item.x + item.width / 2;
              const centerY = item.y + item.height / 2;
              
              ctx.translate(centerX, centerY);
              ctx.rotate((item.rotation || 0) * Math.PI / 180);
              ctx.translate(-centerX, -centerY);

              // Draw the frame with scaling
              ctx.drawImage(img, item.x, item.y, item.width, item.height);
              
              ctx.restore();
            } catch (error) {
              console.warn(`Failed to render frame ${frameIndex} for ${item.name}:`, error);
            }
          }

          frameIndex++;
          
          // Throttled progress updates - only update every 5% or significant frame intervals
          const progress = 30 + (frameIndex / totalFrames) * 55;
          const progressRounded = Math.floor(progress);
          
          // Update progress if it's a significant change (every 5%) or every 10 frames minimum
          if (progressRounded >= lastProgressUpdate + 5 || frameIndex % Math.max(1, Math.floor(totalFrames / 10)) === 0 || frameIndex === totalFrames) {
            lastProgressUpdate = progressRounded;
            safeOnProgress(progress, `Recording frame ${frameIndex}/${totalFrames}... (${Math.round(progress)}%)`);
          }
          
          // Use precise timing for frame rate
          const expectedTime = frameIndex * (1000 / fps);
          const actualTime = Date.now() - startTime;
          const delay = Math.max(0, expectedTime - actualTime);
          
          setTimeout(renderFrame, delay);
        };

        // Start rendering
        renderFrame();
      });

    } catch (error) {
      console.error('❌ Canvas export failed:', error);
      
      // Enhanced error messages
      if (error.message.includes('memory access out of bounds') || 
          error.message.includes('out of memory')) {
        throw new Error('Export failed due to memory limitations. Try:\n• Reducing video duration to under 30 seconds\n• Using fewer media items\n• Using the fallback export method');
      }
      
      throw error;
    }
  }

  // Helper method to add audio to video using FFmpeg (only if needed)
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

  // Fallback export using same Canvas/MediaRecorder method
  async exportVideoFallback({ mediaItems, duration, width = 1920, height = 1080, fps = 15, onProgress }) {
    // The fallback is now the same as the main method since we're using Canvas/MediaRecorder
    // which avoids FFmpeg memory limitations entirely
    return this.exportVideo({ mediaItems, duration, width, height, fps, onProgress });
  }
} 