import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export class MediaProcessor {
  constructor() {
    this.ffmpeg = new FFmpeg();
    this.isInitialized = false;
    this.frameCache = new Map();
    this.processingLocks = new Map(); // Track which items are currently processing
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log('Initializing MediaProcessor with FFmpeg...');
      
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
      this.isInitialized = false;
      throw new Error(`Failed to initialize media processor: ${error.message || error}`);
    }
  }

  // Extract frames from any media type (GIF, WebM, MP4, WebP, etc.)
  async extractFrames(mediaItem, onProgress) {
    const cacheKey = `${mediaItem.id}_frames`;
    
    // Return cached frames if available
    if (this.frameCache.has(cacheKey)) {
      console.log('Using cached frames for:', mediaItem.name);
      return this.frameCache.get(cacheKey);
    }

    // Check if this item is already being processed
    if (this.processingLocks.has(mediaItem.id)) {
      console.log('Media item already being processed, waiting...', mediaItem.name);
      // Wait for the existing processing to complete
      return await this.processingLocks.get(mediaItem.id);
    }

    // Create a processing promise and store it as a lock
    const processingPromise = this.doExtractFrames(mediaItem, onProgress);
    this.processingLocks.set(mediaItem.id, processingPromise);

    try {
      const result = await processingPromise;
      // Clear the lock after successful processing
      this.processingLocks.delete(mediaItem.id);
      return result;
    } catch (error) {
      // Clear the lock after failed processing so it can be retried
      this.processingLocks.delete(mediaItem.id);
      throw error;
    }
  }

  // Internal method that does the actual processing
  async doExtractFrames(mediaItem, onProgress) {
    const cacheKey = `${mediaItem.id}_frames`;

    // Use native browser processing for MP4s to avoid FFmpeg issues
    if (mediaItem.type === 'video' && this.getFileExtension(mediaItem) === 'mp4') {
      console.log('Using native browser processing for MP4:', mediaItem.name);
      return await this.extractFramesNative(mediaItem, onProgress);
    }
    
    await this.initialize();
    
    try {
      console.log('Extracting frames from:', mediaItem.name, 'Type:', mediaItem.type, 'Subtype:', mediaItem.subtype);
      
      const fileExtension = this.getFileExtension(mediaItem);
      const inputFileName = `input.${fileExtension}`;
      const outputPattern = 'frame_%04d.png';
      
      console.log('Processing file:', mediaItem.name, 'Extension:', fileExtension);
      
      // Handle different media sources
      let fileData;
      if (mediaItem.file && mediaItem.file instanceof File) {
        // For uploaded files, use the File object directly
        console.log('Using File object for:', mediaItem.name);
        
        // Add file size validation for MP4s
        if (fileExtension === 'mp4' && mediaItem.file.size > 50 * 1024 * 1024) { // 50MB limit
          throw new Error('MP4 file too large (>50MB). Please use a smaller file or convert to WebM/GIF.');
        }
        
        fileData = await fetchFile(mediaItem.file);
      } else if (mediaItem.url) {
        // For URLs (like Tenor stickers), use the URL
        console.log('Using URL for:', mediaItem.name, mediaItem.url);
        fileData = await fetchFile(mediaItem.url);
      } else {
        throw new Error('No valid file source found');
      }
      
      // Validate file data
      if (!fileData || fileData.byteLength === 0) {
        throw new Error('File data is empty or corrupted');
      }
      
      console.log('File data loaded:', fileData.byteLength, 'bytes');
      
      // Write file to FFmpeg's virtual filesystem
      await this.ffmpeg.writeFile(inputFileName, fileData);
      
      onProgress?.(20, `Extracting frames from ${mediaItem.name}...`);
      
      // Extract frames based on media type
      let frameData;
      if (mediaItem.type === 'video' || mediaItem.subtype === 'gif' || mediaItem.subtype === 'webp' || mediaItem.subtype === 'sticker') {
        frameData = await this.extractVideoFrames(inputFileName, outputPattern, mediaItem, onProgress);
      } else {
        // Static image - create single frame
        frameData = await this.extractStaticFrame(inputFileName, 'static.png');
      }
      
      // Clean up input file
      try {
        await this.ffmpeg.deleteFile(inputFileName);
      } catch (deleteError) {
        console.warn('Could not delete input file:', deleteError);
      }
      
      // Cache the result
      this.frameCache.set(cacheKey, frameData);
      
      onProgress?.(100, `Frames extracted from ${mediaItem.name}`);
      
      return frameData;
      
    } catch (error) {
      console.error('Frame extraction failed for:', mediaItem.name, error);
      
      // Provide helpful error messages for common issues
      let errorMessage = error.message || error;
      if (errorMessage.includes('timeout')) {
        errorMessage = `Processing timeout for ${mediaItem.name}. Try a shorter video or convert to WebM/GIF format.`;
      } else if (errorMessage.includes('memory') || errorMessage.includes('out of bounds')) {
        errorMessage = `File too large or complex: ${mediaItem.name}. Try a smaller file or different format.`;
      } else if (errorMessage.includes('codec') || errorMessage.includes('format')) {
        errorMessage = `Unsupported format in ${mediaItem.name}. Try converting to WebM, MP4 (H.264), or GIF.`;
      }
      
      throw new Error(errorMessage);
    }
  }

  // Native browser-based frame extraction for MP4s
  async extractFramesNative(mediaItem, onProgress) {
    try {
      console.log('Starting native MP4 processing for:', mediaItem.name);
      onProgress?.(10, `Loading ${mediaItem.name}...`);
      
      // Create video element
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';
      
      // Get video URL
      let videoUrl;
      if (mediaItem.file) {
        videoUrl = URL.createObjectURL(mediaItem.file);
      } else if (mediaItem.url) {
        videoUrl = mediaItem.url;
      } else {
        throw new Error('No video source available');
      }
      
      video.src = videoUrl;
      
      return new Promise((resolve, reject) => {
        video.onloadedmetadata = async () => {
          try {
            const duration = video.duration;
            const targetFPS = 10; // Lower FPS for MP4s
            const maxFrames = Math.min(Math.ceil(duration * targetFPS), 150); // Limit frames
            
            console.log(`MP4 metadata loaded: ${duration}s, extracting ${maxFrames} frames`);
            onProgress?.(20, `Extracting ${maxFrames} frames from ${mediaItem.name}...`);
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set reasonable canvas size
            const maxSize = 640;
            const aspectRatio = video.videoWidth / video.videoHeight;
            if (video.videoWidth > video.videoHeight) {
              canvas.width = Math.min(maxSize, video.videoWidth);
              canvas.height = canvas.width / aspectRatio;
            } else {
              canvas.height = Math.min(maxSize, video.videoHeight);
              canvas.width = canvas.height * aspectRatio;
            }
            
            const frames = [];
            
            for (let i = 0; i < maxFrames; i++) {
              const time = (i / targetFPS);
              if (time >= duration) break;
              
              video.currentTime = time;
              
              await new Promise(resolve => {
                video.onseeked = resolve;
                video.onerror = resolve; // Continue even if seek fails
              });
              
              // Draw frame to canvas
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              // Convert to blob URL
              const frameUrl = canvas.toDataURL('image/png');
              
              frames.push({
                index: i,
                url: frameUrl,
                timestamp: time
              });
              
              // Update progress
              if (i % 5 === 0) {
                const progress = 20 + (i / maxFrames) * 70;
                onProgress?.(progress, `Extracted ${i + 1}/${maxFrames} frames from ${mediaItem.name}...`);
              }
            }
            
            // Cleanup
            URL.revokeObjectURL(videoUrl);
            
            const frameData = {
              type: 'animated',
              frames,
              duration: frames.length / targetFPS,
              fps: targetFPS,
              frameCount: frames.length
            };
            
            // Cache the result
            this.frameCache.set(`${mediaItem.id}_frames`, frameData);
            
            onProgress?.(100, `Frames extracted from ${mediaItem.name}`);
            console.log(`Successfully extracted ${frames.length} frames from MP4:`, mediaItem.name);
            
            resolve(frameData);
            
          } catch (error) {
            console.error('Native MP4 processing failed:', error);
            URL.revokeObjectURL(videoUrl);
            reject(error);
          }
        };
        
        video.onerror = (error) => {
          console.error('Video loading failed:', error);
          URL.revokeObjectURL(videoUrl);
          reject(new Error(`Failed to load MP4: ${mediaItem.name}. File may be corrupted.`));
        };
        
        // Timeout for loading
        setTimeout(() => {
          URL.revokeObjectURL(videoUrl);
          reject(new Error(`MP4 loading timeout: ${mediaItem.name}`));
        }, 30000);
      });
      
    } catch (error) {
      console.error('Native MP4 extraction failed:', error);
      throw new Error(`MP4 processing failed: ${error.message}`);
    }
  }

  async getMediaInfo(fileName) {
    try {
      console.log('Getting media info for:', fileName);
      
      // Use ffprobe to get media information
      await this.ffmpeg.exec([
        '-i', fileName,
        '-f', 'null', '-'
      ]);
      
    } catch (error) {
      // FFmpeg outputs info to stderr even on success, so we expect this to "fail"
      // This is normal behavior - the media info is in the stderr output
      console.log('FFmpeg info command completed (expected "error")', fileName);
    }
    
    // For now, return default values - in a full implementation you'd parse the output
    // These defaults should work for most media types
    const mediaInfo = {
      duration: 3.0, // Default duration
      fps: 10, // Default frame rate
      width: 400,
      height: 300
    };
    
    console.log('Using default media info for:', fileName, mediaInfo);
    return mediaInfo;
  }

  async extractVideoFrames(inputFileName, outputPattern, mediaItem, onProgress) {
    const targetFPS = 15; // 15 FPS for smoother playback
    
    try {
      console.log('Starting frame extraction for:', mediaItem.name, 'Input file:', inputFileName);
      
      let processedInputFile = inputFileName;
      
      // Pre-process MP4 files to a simpler format to prevent hanging
      if (inputFileName.endsWith('.mp4')) {
        console.log('Pre-processing MP4 file for compatibility...');
        onProgress?.(25, `Converting ${mediaItem.name} for processing...`);
        
        const tempFileName = 'temp_converted.webm';
        
        try {
          // Convert MP4 to WebM first with simple settings
          const convertArgs = [
            '-i', inputFileName,
            '-c:v', 'libvpx',
            '-crf', '30',
            '-b:v', '1M',
            '-vf', 'scale=640:-1', // Scale down to reduce complexity
            '-t', '30', // Limit to 30 seconds to prevent memory issues
            '-an', // Remove audio for now
            '-y',
            tempFileName
          ];
          
          console.log('MP4 conversion command:', convertArgs.join(' '));
          
          const convertTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('MP4 conversion timeout')), 45000);
          });
          
          await Promise.race([this.ffmpeg.exec(convertArgs), convertTimeout]);
          
          processedInputFile = tempFileName;
          console.log('MP4 conversion completed, using:', processedInputFile);
          onProgress?.(40, `Extracting frames from converted ${mediaItem.name}...`);
          
        } catch (convertError) {
          console.warn('MP4 conversion failed, trying direct processing:', convertError);
          onProgress?.(30, `Direct processing ${mediaItem.name}...`);
        }
      }
      
      // Use MP4-specific options for better compatibility
      let ffmpegArgs;
      if (inputFileName.endsWith('.mp4')) {
        // Simplified MP4 processing
        ffmpegArgs = [
          '-i', processedInputFile,
          '-vf', `fps=${Math.min(targetFPS, 10)}`, // Lower FPS for MP4
          '-vframes', '150', // Limit frames
          '-f', 'image2',
          '-pix_fmt', 'rgb24', // Simpler pixel format for MP4
          '-s', '640x360', // Fixed smaller size to reduce complexity
          '-y',
          outputPattern
        ];
      } else {
        // Standard processing for other formats
        ffmpegArgs = [
          '-i', inputFileName,
          '-vf', `fps=${targetFPS}`,
          '-f', 'image2',
          '-pix_fmt', 'rgba',
          '-y',
          outputPattern
        ];
      }
      
      console.log('FFmpeg frame extraction command:', ffmpegArgs.join(' '));
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('FFmpeg processing timeout (60s)')), 60000);
      });
      
      const execPromise = this.ffmpeg.exec(ffmpegArgs);
      
      await Promise.race([execPromise, timeoutPromise]);
      console.log('FFmpeg frame extraction completed for:', mediaItem.name);
      
      // Clean up temporary file if we created one
      if (processedInputFile !== inputFileName) {
        try {
          await this.ffmpeg.deleteFile(processedInputFile);
        } catch (cleanupError) {
          console.warn('Could not cleanup temp file:', cleanupError);
        }
      }
      
    } catch (ffmpegError) {
      console.error('FFmpeg execution failed for:', mediaItem.name, ffmpegError);
      
      // Try ultra-simple fallback for problematic MP4s
      if (inputFileName.endsWith('.mp4') && !ffmpegError.message.includes('timeout')) {
        console.log('Trying ultra-simple MP4 fallback...');
        try {
          const ultraSimpleArgs = [
      '-i', inputFileName,
            '-vf', 'fps=5,scale=320:240', // Very low resolution and FPS
            '-vframes', '50', // Very limited frames
            '-f', 'image2',
            '-pix_fmt', 'rgb24',
            '-y',
      outputPattern
          ];
          
          console.log('Ultra-simple fallback command:', ultraSimpleArgs.join(' '));
          const ultraTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Ultra-simple timeout (20s)')), 20000);
          });
          
          await Promise.race([this.ffmpeg.exec(ultraSimpleArgs), ultraTimeout]);
          console.log('Ultra-simple MP4 processing succeeded for:', mediaItem.name);
        } catch (ultraError) {
          console.error('All MP4 processing methods failed:', ultraError);
          throw new Error(`MP4 processing failed: This MP4 format is not supported. Please convert to WebM or GIF format for best results.`);
        }
      } else {
        throw new Error(`FFmpeg frame extraction failed: ${ffmpegError.message || ffmpegError}`);
      }
    }
    
    // Read extracted frames using the same pattern
    const frames = [];
    let frameIndex = 1;
    
    try {
      console.log('Reading extracted frames for:', mediaItem.name);
      
      while (true) {
        const frameName = outputPattern.replace('%04d', frameIndex.toString().padStart(4, '0'));
        
        try {
          const frameData = await this.ffmpeg.readFile(frameName);
          
          // Validate frame data
          if (!frameData || frameData.byteLength === 0) {
            console.warn('Empty frame data for:', frameName);
            break;
          }
        
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
          } catch (deleteError) {
            console.warn('Could not delete frame file:', frameName, deleteError);
        }
        
        frameIndex++;
        
        // Update progress
        if (onProgress && frameIndex % 5 === 0) {
            onProgress(20 + (frameIndex * 60 / 100), `Processed ${frameIndex} frames for ${mediaItem.name}...`);
          }
          
          // Safety limit to prevent infinite loops
          if (frameIndex > 1000) {
            console.warn('Frame extraction limit reached (1000 frames) for:', mediaItem.name);
            break;
          }
          
        } catch (readError) {
          // Expected when no more frames - this is normal end condition
          console.log('No more frames to read for:', mediaItem.name, 'Total frames:', frameIndex - 1);
          break;
        }
      }
    } catch (error) {
      console.error('Error reading frames for:', mediaItem.name, error);
      throw new Error(`Failed to read extracted frames: ${error.message || error}`);
    }
    
    if (frames.length === 0) {
      throw new Error(`No frames were extracted from ${mediaItem.name}. The file may be corrupted or in an unsupported format.`);
    }
    
    // Calculate actual duration based on extracted frames
    const actualDuration = frames.length / targetFPS;
    
    console.log(`Successfully extracted ${frames.length} frames from ${mediaItem.name} at ${targetFPS} FPS, duration: ${actualDuration}s`);
    
    return {
      type: 'animated',
      frames,
      duration: actualDuration, // Use actual duration from frame count
      fps: targetFPS,
      frameCount: frames.length
    };
  }

  async extractStaticFrame(inputFileName, outputName) {
    try {
      console.log('Extracting static frame for:', inputFileName, 'Output:', outputName);
      
    // Convert to PNG with unique name
      const ffmpegArgs = [
      '-i', inputFileName,
      '-vframes', '1', // Extract only 1 frame
        '-f', 'image2', // Force image output format
        '-pix_fmt', 'rgba', // Use RGBA for transparency support
        '-y', // Overwrite output files
      outputName
      ];
      
      console.log('FFmpeg static frame command:', ffmpegArgs.join(' '));
      await this.ffmpeg.exec(ffmpegArgs);
      console.log('Static frame extraction completed');
      
    } catch (ffmpegError) {
      console.error('FFmpeg static frame extraction failed:', ffmpegError);
      throw new Error(`Static frame extraction failed: ${ffmpegError.message || ffmpegError}`);
    }
    
    // Read the frame with retry logic
    let frameData;
    try {
      frameData = await this.readFileWithRetry(outputName);
      console.log('Static frame data read successfully:', frameData.byteLength, 'bytes');
      
    } catch (readError) {
      console.error('Failed to read static frame:', readError);
      throw new Error(`Failed to read extracted frame: ${readError.message || readError}`);
    }
    
    const blob = new Blob([frameData.buffer], { type: 'image/png' });
    const frameUrl = URL.createObjectURL(blob);
    
    // Clean up frame file
    try {
      await this.ffmpeg.deleteFile(outputName);
      console.log('Cleaned up static frame file:', outputName);
    } catch (deleteError) {
      console.warn('Could not delete static frame file:', outputName, deleteError);
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
    let extension = 'png'; // Default fallback
    
    if (mediaItem.name) {
      try {
        const nameParts = mediaItem.name.split('.');
        if (nameParts.length > 1) {
          extension = nameParts.pop().toLowerCase();
          console.log('Extracted extension from filename:', extension);
        }
      } catch (error) {
        console.warn('Error extracting extension from filename:', mediaItem.name, error);
      }
    }
    
    // Validate and map extensions
    const supportedExtensions = {
      // Video formats
      'mp4': 'mp4',
      'webm': 'webm',
      'mov': 'mov',
      'avi': 'avi',
      'mkv': 'mkv',
      // Image formats
      'gif': 'gif',
      'webp': 'webp',
      'png': 'png',
      'jpg': 'jpg',
      'jpeg': 'jpg',
      'bmp': 'bmp',
      'tiff': 'tiff',
      'tif': 'tiff',
      // Audio formats
      'mp3': 'mp3',
      'wav': 'wav',
      'ogg': 'ogg',
      'aac': 'aac'
    };
    
    // Use the mapped extension if supported, otherwise fallback based on type/subtype
    if (supportedExtensions[extension]) {
      return supportedExtensions[extension];
    }
    
    // Fallback based on media type and subtype
    if (mediaItem.subtype === 'gif') return 'gif';
    if (mediaItem.subtype === 'webp') return 'webp';
    if (mediaItem.subtype === 'sticker') return 'gif'; // Tenor stickers are usually GIFs
    if (mediaItem.type === 'video') return 'mp4';
    if (mediaItem.type === 'audio') return 'mp3';
    
    console.log('Using extension for', mediaItem.name, ':', extension);
    return extension;
  }

  // Helper function to read files from FFmpeg with retry logic
  async readFileWithRetry(fileName, maxRetries = 3, delayMs = 100) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Reading file ${fileName}, attempt ${attempt}/${maxRetries}`);
        const fileData = await this.ffmpeg.readFile(fileName);
        
        // Validate file data
        if (!fileData || fileData.byteLength === 0) {
          throw new Error('File data is empty');
        }
        
        console.log(`Successfully read ${fileName}: ${fileData.byteLength} bytes`);
        return fileData;
        
      } catch (error) {
        console.warn(`Attempt ${attempt} failed to read ${fileName}:`, error.message);
        
        if (attempt === maxRetries) {
          throw new Error(`Failed to read ${fileName} after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
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
    
    // Use more precise frame index calculation to prevent flickering
    // Round to nearest frame instead of flooring for better precision
    const frameIndex = Math.round(time * frameData.fps);
    const clampedIndex = Math.max(0, Math.min(frameIndex, frameData.frames.length - 1));
    
    // Add additional bounds checking
    if (clampedIndex >= frameData.frames.length) {
      return frameData.frames[frameData.frames.length - 1];
    }
    
    // Return the frame if it exists, otherwise null
    const selectedFrame = frameData.frames[clampedIndex];
    
    // Debug logging to track frame selection
    if (!selectedFrame) {
      console.warn(`No frame found at index ${clampedIndex} for time ${time}, total frames: ${frameData.frames.length}`);
    }
    
    return selectedFrame || null;
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

  // Rescale existing frames to new dimensions (background processing)
  async rescaleFrames(mediaItemId, targetWidth, targetHeight, onProgress) {
    const cacheKey = `${mediaItemId}_frames`;
    
    if (!this.frameCache.has(cacheKey)) {
      throw new Error('No cached frames found for rescaling');
    }
    
    const existingFrameData = this.frameCache.get(cacheKey);
    console.log(`🔄 Starting background rescaling for item ${mediaItemId} to ${targetWidth}x${targetHeight}`);
    
    return new Promise((resolve, reject) => {
      const rescaleNextFrame = async (frameIndex) => {
        if (frameIndex >= existingFrameData.frames.length) {
          // All frames processed
          console.log(`✅ Rescaling complete for item ${mediaItemId}`);
          onProgress?.(100, 'Rescaling complete');
          resolve(existingFrameData);
          return;
        }
        
        const frame = existingFrameData.frames[frameIndex];
        
        try {
          // Load original frame
          const originalImg = new Image();
          originalImg.crossOrigin = 'anonymous';
          
          originalImg.onload = () => {
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
            
            // Convert to blob URL and replace the frame
            canvas.toBlob((blob) => {
              // Clean up old frame URL
              if (frame.url.startsWith('blob:')) {
                URL.revokeObjectURL(frame.url);
              }
              
              // Update frame with new scaled version
              frame.url = URL.createObjectURL(blob);
              frame.scaledWidth = targetWidth;
              frame.scaledHeight = targetHeight;
              frame.isPreScaled = true;
              
              // Update progress
              const progress = (frameIndex / existingFrameData.frames.length) * 100;
              onProgress?.(progress, `Rescaling frame ${frameIndex + 1}/${existingFrameData.frames.length}`);
              
              // Process next frame with small delay to prevent blocking
              setTimeout(() => rescaleNextFrame(frameIndex + 1), 1);
              
            }, 'image/png', 1.0);
          };
          
          originalImg.onerror = () => {
            console.warn(`Failed to load frame ${frameIndex} for rescaling, skipping`);
            // Skip this frame and continue
            setTimeout(() => rescaleNextFrame(frameIndex + 1), 1);
          };
          
          originalImg.src = frame.url;
          
        } catch (error) {
          console.warn(`Error rescaling frame ${frameIndex}:`, error);
          // Skip this frame and continue
          setTimeout(() => rescaleNextFrame(frameIndex + 1), 1);
        }
      };
      
      // Start rescaling
      rescaleNextFrame(0);
    });
  }

  // Check if frames are pre-scaled to target dimensions
  areFramesPreScaled(mediaItemId, targetWidth, targetHeight) {
    const cacheKey = `${mediaItemId}_frames`;
    
    if (!this.frameCache.has(cacheKey)) {
      return false;
    }
    
    const frameData = this.frameCache.get(cacheKey);
    if (frameData.frames.length === 0) {
      return false;
    }
    
    const firstFrame = frameData.frames[0];
    return firstFrame.isPreScaled && 
           firstFrame.scaledWidth === targetWidth && 
           firstFrame.scaledHeight === targetHeight;
  }
} 