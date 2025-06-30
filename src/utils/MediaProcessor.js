import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export class MediaProcessor {
  constructor() {
    this.ffmpeg = new FFmpeg();
    this.isInitialized = false;
    this.frameCache = new Map();
    this.processingQueue = [];
    this.isProcessing = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Load FFmpeg with WASM
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      this.isInitialized = true;
      console.log('MediaProcessor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MediaProcessor:', error);
      throw new Error('Failed to initialize media processor');
    }
  }

  // Get queue status for UI display
  getQueueStatus() {
    return {
      queueLength: this.processingQueue.length,
      isProcessing: this.isProcessing,
      totalInProgress: this.isProcessing ? this.processingQueue.length + 1 : this.processingQueue.length
    };
  }

  // Process queue sequentially to prevent frame mixing
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log('🔄 Processing queue with', this.processingQueue.length, 'items');

    while (this.processingQueue.length > 0) {
      const { mediaItem, onProgress, resolve, reject } = this.processingQueue.shift();
      
      try {
        console.log('📤 Processing:', mediaItem.name, '(', this.processingQueue.length, 'remaining in queue)');
        const result = await this.doExtractFrames(mediaItem, onProgress);
        resolve(result);
      } catch (error) {
        console.error('❌ Processing failed for:', mediaItem.name, error);
        reject(error);
      }
    }

    this.isProcessing = false;
    console.log('✅ Queue processing complete');
  }

  // Extract frames from any media type (GIF, WebM, MP4, WebP, etc.)
  async extractFrames(mediaItem, onProgress) {
    const cacheKey = `${mediaItem.id}_frames`;
    
    // Return cached frames if available
    if (this.frameCache.has(cacheKey)) {
      console.log('Using cached frames for:', mediaItem.name);
      return this.frameCache.get(cacheKey);
    }

    // Add to processing queue
    return new Promise((resolve, reject) => {
      console.log('📥 Adding to queue:', mediaItem.name);
      this.processingQueue.push({ mediaItem, onProgress, resolve, reject });
      this.processQueue(); // Start processing if not already running
    });
  }

  // Internal method that does the actual frame extraction
  async doExtractFrames(mediaItem, onProgress) {
    const cacheKey = `${mediaItem.id}_frames`;
    
    await this.initialize();
    
    try {
      console.log('Extracting frames from:', mediaItem.name, 'Type:', mediaItem.type, 'Subtype:', mediaItem.subtype);
      
      // Use unique file names to prevent conflicts when processing multiple files
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substr(2, 9);
      const inputFileName = `input_${mediaItem.id}_${timestamp}_${randomId}.${this.getFileExtension(mediaItem)}`;
      const outputPattern = `frame_${mediaItem.id}_${timestamp}_${randomId}_%04d.png`;
      
      await this.ffmpeg.writeFile(inputFileName, await fetchFile(mediaItem.url));
      
      onProgress?.(10, `Analyzing ${mediaItem.name}...`);
      
      // Get media information
      const mediaInfo = await this.getMediaInfo(inputFileName);
      console.log('Media info for', mediaItem.name, ':', mediaInfo);
      
      onProgress?.(20, `Extracting frames from ${mediaItem.name}...`);
      
      // Extract frames based on media type
      let frameData;
      if (mediaItem.type === 'video' || mediaItem.subtype === 'gif' || mediaItem.subtype === 'webp') {
        frameData = await this.extractVideoFrames(inputFileName, outputPattern, mediaInfo, onProgress, mediaItem.name);
      } else {
        // Static image - create single frame
        frameData = await this.extractStaticFrame(inputFileName, `static_${mediaItem.id}_${timestamp}_${randomId}.png`, mediaInfo);
      }
      
      // Clean up input file
      try {
        await this.ffmpeg.deleteFile(inputFileName);
      } catch (error) {
        console.warn('Could not delete input file:', inputFileName);
      }
      
      // Cache the result
      this.frameCache.set(cacheKey, frameData);
      
      onProgress?.(100, `Frames extracted from ${mediaItem.name}`);
      
      return frameData;
      
    } catch (error) {
      console.error('Frame extraction failed for:', mediaItem.name, error);
      throw new Error(`Failed to extract frames from ${mediaItem.name}: ${error.message}`);
    }
  }

  async getMediaInfo(fileName) {
    try {
      // Use ffprobe to get media information
      await this.ffmpeg.exec([
        '-i', fileName,
        '-f', 'null', '-'
      ]);
    } catch (error) {
      // FFmpeg outputs info to stderr even on success, so we expect this to "fail"
    }
    
    // For now, return default values - in a full implementation you'd parse the output
    return {
      duration: 3.0, // Default duration
      fps: 10, // Default frame rate
      width: 400,
      height: 300
    };
  }

  async extractVideoFrames(inputFileName, outputPattern, mediaInfo, onProgress, mediaName) {
    const targetFPS = 15; // 15 FPS for smoother playback
    
    // Extract frames at specified FPS with unique output pattern
    await this.ffmpeg.exec([
      '-i', inputFileName,
      '-vf', `fps=${targetFPS}`, // Extract at target FPS for smooth animation
      '-y', // Overwrite output files
      outputPattern
    ]);
    
    // Read extracted frames using the same pattern
    const frames = [];
    let frameIndex = 1;
    const basePattern = outputPattern.replace('%04d', '');
    
    try {
      while (true) {
        const frameName = outputPattern.replace('%04d', frameIndex.toString().padStart(4, '0'));
        const frameData = await this.ffmpeg.readFile(frameName);
        
        // Convert to blob URL
        const blob = new Blob([frameData.buffer], { type: 'image/png' });
        const frameUrl = URL.createObjectURL(blob);
        
        frames.push({
          index: frameIndex - 1,
          url: frameUrl,
          timestamp: (frameIndex - 1) / targetFPS
        });
        
        // Clean up frame file immediately after reading
        try {
          await this.ffmpeg.deleteFile(frameName);
        } catch (error) {
          console.warn('Could not delete frame file:', frameName);
        }
        
        frameIndex++;
        
        // Update progress
        if (onProgress && frameIndex % 5 === 0) {
          onProgress(20 + (frameIndex * 60 / 100), `Processed ${frameIndex} frames for ${mediaName}...`);
        }
      }
    } catch (error) {
      // Expected when no more frames
      console.log(`Extracted ${frames.length} frames from ${mediaName} at ${targetFPS} FPS`);
    }
    
    // Calculate actual duration based on extracted frames
    const actualDuration = frames.length / targetFPS;
    
    return {
      type: 'animated',
      frames,
      duration: actualDuration, // Use actual duration from frame count
      fps: targetFPS,
      frameCount: frames.length
    };
  }

  async extractStaticFrame(inputFileName, outputName, mediaInfo) {
    // Convert to PNG with unique name
    await this.ffmpeg.exec([
      '-i', inputFileName,
      '-vframes', '1', // Extract only 1 frame
      '-y',
      outputName
    ]);
    
    // Read the frame
    const frameData = await this.ffmpeg.readFile(outputName);
    const blob = new Blob([frameData.buffer], { type: 'image/png' });
    const frameUrl = URL.createObjectURL(blob);
    
    // Clean up frame file
    try {
      await this.ffmpeg.deleteFile(outputName);
    } catch (error) {
      console.warn('Could not delete static frame file:', outputName);
    }
    
    return {
      type: 'static',
      frames: [{
        index: 0,
        url: frameUrl,
        timestamp: 0
      }],
      duration: 5, // Default duration for static images
      fps: 1,
      frameCount: 1
    };
  }

  getFileExtension(mediaItem) {
    if (mediaItem.name) {
      const ext = mediaItem.name.split('.').pop().toLowerCase();
      return ext;
    }
    
    // Fallback based on type
    if (mediaItem.type === 'video') return 'mp4';
    if (mediaItem.subtype === 'gif') return 'gif';
    if (mediaItem.subtype === 'webp') return 'webp';
    return 'png';
  }

  // Get frame for specific time
  getFrameAtTime(frameData, time) {
    if (frameData.type === 'static') {
      return frameData.frames[0];
    }
    
    // For animated media, check if time is within bounds
    if (time >= frameData.duration) {
      // Time is beyond the media duration - return null to hide the media
      return null;
    }
    
    // Find the appropriate frame without looping
    const frameIndex = Math.floor(time * frameData.fps);
    const clampedIndex = Math.max(0, Math.min(frameIndex, frameData.frames.length - 1));
    
    // Return the frame if it exists, otherwise null
    return frameData.frames[clampedIndex] || null;
  }

  // Create standardized media processor
  createProcessor(mediaItem, frameData) {
    return {
      id: mediaItem.id,
      type: frameData.type,
      frames: frameData.frames,
      duration: frameData.duration,
      fps: frameData.fps,
      isAnimated: frameData.type === 'animated',
      originalFrames: frameData.frames, // Keep original frames for scaling
      
      getCurrentFrame: (time) => {
        return this.getFrameAtTime(frameData, time);
      },
      
      // Get scaled frame at specific time
      getScaledFrame: async (time, targetWidth, targetHeight) => {
        const frame = this.getFrameAtTime(frameData, time);
        if (!frame) return null;
        
        // If dimensions haven't changed, return original frame
        const originalImg = new Image();
        originalImg.src = frame.url;
        
        return new Promise((resolve) => {
          originalImg.onload = () => {
            if (originalImg.width === targetWidth && originalImg.height === targetHeight) {
              resolve(frame);
              return;
            }
            
            // Create scaled version
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            
            // Use high-quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // Draw scaled image
            ctx.drawImage(originalImg, 0, 0, targetWidth, targetHeight);
            
            // Convert to blob URL
            canvas.toBlob((blob) => {
              const scaledUrl = URL.createObjectURL(blob);
              resolve({
                index: frame.index,
                url: scaledUrl,
                timestamp: frame.timestamp,
                isScaled: true,
                originalUrl: frame.url
              });
            }, 'image/png', 1.0);
          };
          
          if (originalImg.complete) {
            originalImg.onload();
          }
        });
      },
      
      // Create image element for current frame
      createImageElement: (time) => {
        const frame = this.getFrameAtTime(frameData, time);
        if (!frame) return null; // Return null if no frame available
        
        const img = new Image();
        img.src = frame.url;
        img.crossOrigin = 'anonymous';
        return img;
      },
      
      // Create scaled image element
      createScaledImageElement: async (time, targetWidth, targetHeight) => {
        const scaledFrame = await this.getScaledFrame(time, targetWidth, targetHeight);
        if (!scaledFrame) return null;
        
        const img = new Image();
        img.src = scaledFrame.url;
        img.crossOrigin = 'anonymous';
        return img;
      },
      
      // Check if media should be visible at given time
      isVisibleAtTime: (time) => {
        return time >= 0 && time < frameData.duration;
      }
    };
  }

  // Clear cache for specific media item
  clearCache(mediaItemId) {
    const cacheKey = `${mediaItemId}_frames`;
    if (this.frameCache.has(cacheKey)) {
      const frameData = this.frameCache.get(cacheKey);
      // Clean up blob URLs to prevent memory leaks
      frameData.frames.forEach(frame => {
        if (frame.url.startsWith('blob:')) {
          URL.revokeObjectURL(frame.url);
        }
      });
      this.frameCache.delete(cacheKey);
    }
  }

  // Clear all cache
  clearAllCache() {
    this.frameCache.forEach((frameData, key) => {
      frameData.frames.forEach(frame => {
        if (frame.url.startsWith('blob:')) {
          URL.revokeObjectURL(frame.url);
        }
      });
    });
    this.frameCache.clear();
  }
} 