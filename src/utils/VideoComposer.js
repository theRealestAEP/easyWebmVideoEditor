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
      
      // Filter out audio items for video processing
      const audioItems = mediaItems.filter(item => item.type === 'audio');

      console.log('🎬 Starting Canvas Capture Export:', {
        totalItems: mediaItems.length,
        audioItems: audioItems.length,
        duration,
        dimensions: `${width}x${height}`,
        fps
      });

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

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      return new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          try {
            let finalBlob = new Blob(chunks, { type: 'video/webm' });
            
            // If we have audio, we need to mix it with the video
            if (audioItems.length > 0) {
              try {
                finalBlob = await this.addAudioToVideo(finalBlob, audioItems[0], duration);
              } catch (audioError) {
                console.warn('Failed to add audio, proceeding with video only:', audioError);
              }
            }
            
            safeOnProgress(100, 'Export complete! 🎉');
            const url = URL.createObjectURL(finalBlob);
            console.log('✅ Canvas capture export completed successfully');
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

        let frameIndex = 0;
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        const timeStep = 1 / fps;

        const renderFrame = async () => {
          if (frameIndex >= totalFrames) {
            recorder.stop();
            return;
          }

          const currentTime = frameIndex * timeStep;
          
          // Simple: just use the frame progress as the percentage
          const frameProgress = (frameIndex / totalFrames) * 100;
          
          safeOnProgress(
            frameProgress, 
            `Capturing frame ${frameIndex + 1}/${totalFrames}`
          );
          
          // Use the callback to seek the timeline to the exact time
          await onTimelineSeek(currentTime);
          
          // Minimal delay - just enough for canvas to render
          await new Promise(resolve => setTimeout(resolve, 16)); // One frame at 60fps

          // Clear recording canvas
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

          // Draw the canvas content
          ctx.drawImage(existingCanvas, offsetX, offsetY, scaledWidth, scaledHeight);

          frameIndex++;
          
          // Use the exact same timing as the preview framerate
          const nextFrameDelay = 1000 / fps;
          setTimeout(renderFrame, nextFrameDelay);
        };

        // Start the frame capture process
        renderFrame();
      });

    } catch (error) {
      console.error('❌ Canvas capture export failed:', error);
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

  // Fallback export using same Canvas capture method
  async exportVideoFallback({ mediaItems, duration, width = 1920, height = 1080, fps = 15, onProgress, onTimelineSeek }) {
    // The fallback now uses the same canvas capture approach for consistency
    // This ensures both methods produce identical results
    return this.exportVideo({ mediaItems, duration, width, height, fps, onProgress, onTimelineSeek });
  }
} 