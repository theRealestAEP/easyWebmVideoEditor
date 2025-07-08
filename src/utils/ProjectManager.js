class ProjectManager {
  constructor() {
    this.dbName = 'PartyMakerProjects';
    this.dbVersion = 1;
    this.db = null;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndoSteps = 50; // Limit undo history to prevent memory issues
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Store for projects
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('lastModified', 'lastModified', { unique: false });
        }
        
        // Store for project files (for smaller files)
        if (!db.objectStoreNames.contains('projectFiles')) {
          db.createObjectStore('projectFiles', { keyPath: 'id' });
        }
        
        // Store for undo/redo history
        if (!db.objectStoreNames.contains('history')) {
          db.createObjectStore('history', { keyPath: 'sessionId' });
        }
      };
    });
  }

  // Create project state snapshot for undo/redo
  createSnapshot(state) {
    const { mediaItems, sourceMedia, currentTime, duration, settings, selectedItem } = state;
    
    // For undo/redo, we store lightweight references rather than full file data
    const lightweightMediaItems = mediaItems.map(item => ({
      ...item,
      // Don't store the actual file data in undo history
      file: item.file ? { name: item.file.name, size: item.file.size, type: item.file.type } : null
    }));
    
    const lightweightSourceMedia = sourceMedia.map(item => ({
      ...item,
      file: item.file ? { name: item.file.name, size: item.file.size, type: item.file.type } : null,
      // Keep thumbnails for quick preview
      thumbnail: item.thumbnail
    }));
    
    return {
      mediaItems: lightweightMediaItems,
      sourceMedia: lightweightSourceMedia,
      currentTime,
      duration,
      settings,
      selectedItem,
      timestamp: Date.now()
    };
  }

  // Add state to undo stack
  pushState(state) {
    const snapshot = this.createSnapshot(state);
    
    // Remove oldest states if we exceed max undo steps
    if (this.undoStack.length >= this.maxUndoSteps) {
      this.undoStack.shift();
    }
    
    this.undoStack.push(snapshot);
    
    // Clear redo stack when new action is performed
    this.redoStack = [];
    
    // console.log('State pushed to undo stack. Stack size:', this.undoStack.length);
  }

  // Undo last action
  undo(currentState) {
    if (this.undoStack.length <= 1) {
      // console.log('Nothing to undo');
      return null;
    }
    
    // Move current state to redo stack
    const currentSnapshot = this.createSnapshot(currentState);
    this.redoStack.push(currentSnapshot);
    
    // Remove current state from undo stack and get previous state
    this.undoStack.pop();
    const previousState = this.undoStack[this.undoStack.length - 1];
    
    // console.log('Undo performed. Undo stack size:', this.undoStack.length, 'Redo stack size:', this.redoStack.length);
    return previousState;
  }

  // Redo last undone action
  redo() {
    if (this.redoStack.length === 0) {
      console.log('Nothing to redo');
      return null;
    }
    
    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);
    
    // console.log('Redo performed. Undo stack size:', this.undoStack.length, 'Redo stack size:', this.redoStack.length);
    return nextState;
  }

  // Save complete project to IndexedDB
  async saveProject(projectData, projectName = null) {
    await this.init();
    
    const name = projectName || `Project ${new Date().toLocaleString()}`;
    const id = projectName ? this.generateProjectId(projectName) : Date.now().toString();
    
    try {
      // Separate small files (store in DB) from large files (store references only)
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for storing files in DB
      const processedSourceMedia = [];
      const filesToStore = new Map();
      
      for (const item of projectData.sourceMedia) {
        if (item.file && item.file.size < MAX_FILE_SIZE) {
          // Store small files in database
          const fileId = `file_${id}_${Date.now()}_${Math.random()}`;
          filesToStore.set(fileId, {
            id: fileId,
            file: item.file,
            name: item.file.name,
            type: item.file.type,
            size: item.file.size
          });
          
          processedSourceMedia.push({
            ...item,
            fileId: fileId,
            file: null // Remove file object, we'll restore it on load
          });
        } else {
          // For large files, just store metadata
          processedSourceMedia.push({
            ...item,
            file: null,
            isLargeFile: true,
            originalFileName: item.file?.name,
            originalFileSize: item.file?.size,
            originalFileType: item.file?.type
          });
        }
      }
      
      const project = {
        id,
        name,
        mediaItems: projectData.mediaItems,
        sourceMedia: processedSourceMedia,
        currentTime: projectData.currentTime,
        duration: projectData.duration,
        settings: projectData.settings,
        selectedItem: projectData.selectedItem,
        lastModified: Date.now(),
        version: '1.0'
      };
      
      // Save project
      const transaction = this.db.transaction(['projects', 'projectFiles'], 'readwrite');
      const projectStore = transaction.objectStore('projects');
      const fileStore = transaction.objectStore('projectFiles');
      
      await projectStore.put(project);
      
      // Save associated files
      for (const [fileId, fileData] of filesToStore) {
        await fileStore.put(fileData);
      }
      
      console.log('Project saved successfully:', name);
      return { success: true, projectId: id, projectName: name };
      
    } catch (error) {
      console.error('Error saving project:', error);
      return { success: false, error: error.message };
    }
  }

  // Load project from IndexedDB
  async loadProject(projectId) {
    await this.init();
    
    try {
      const transaction = this.db.transaction(['projects', 'projectFiles'], 'readonly');
      const projectStore = transaction.objectStore('projects');
      const fileStore = transaction.objectStore('projectFiles');
      
      const project = await new Promise((resolve, reject) => {
        const request = projectStore.get(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (!project) {
        throw new Error('Project not found');
      }
      
      // Restore files for source media
      const restoredSourceMedia = [];
      
      for (const item of project.sourceMedia) {
        if (item.fileId) {
          // Restore small files from database
          const fileData = await new Promise((resolve, reject) => {
            const request = fileStore.get(item.fileId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          
          if (fileData) {
            restoredSourceMedia.push({
              ...item,
              file: fileData.file,
              fileId: undefined
            });
          } else {
            // File not found, mark as missing
            restoredSourceMedia.push({
              ...item,
              isMissingFile: true
            });
          }
        } else if (item.isLargeFile) {
          // Large file - user will need to re-import
          restoredSourceMedia.push({
            ...item,
            needsReimport: true
          });
        } else {
          // No file (e.g., Tenor stickers)
          restoredSourceMedia.push(item);
        }
      }
      
      const restoredProject = {
        ...project,
        sourceMedia: restoredSourceMedia
      };
      
      // console.log('Project loaded successfully:', project.name);
      return { success: true, project: restoredProject };
      
    } catch (error) {
      console.error('Error loading project:', error);
      return { success: false, error: error.message };
    }
  }

  // Get list of saved projects
  async getProjectList() {
    await this.init();
    
    try {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const index = store.index('lastModified');
      
      const projects = await new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      // Sort by last modified (newest first) and return lightweight project info
      return projects
        .sort((a, b) => b.lastModified - a.lastModified)
        .map(project => ({
          id: project.id,
          name: project.name,
          lastModified: project.lastModified,
          itemCount: project.mediaItems.length,
          sourceCount: project.sourceMedia.length
        }));
        
    } catch (error) {
      console.error('Error getting project list:', error);
      return [];
    }
  }

  // Delete project
  async deleteProject(projectId) {
    await this.init();
    
    try {
      const transaction = this.db.transaction(['projects', 'projectFiles'], 'readwrite');
      const projectStore = transaction.objectStore('projects');
      const fileStore = transaction.objectStore('projectFiles');
      
      // Get project to find associated files
      const project = await new Promise((resolve, reject) => {
        const request = projectStore.get(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (project) {
        // Delete associated files
        for (const item of project.sourceMedia) {
          if (item.fileId) {
            await fileStore.delete(item.fileId);
          }
        }
      }
      
      // Delete project
      await projectStore.delete(projectId);
      
      // console.log('Project deleted successfully:', projectId);
      return { success: true };
      
    } catch (error) {
      console.error('Error deleting project:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate consistent project ID from name
  generateProjectId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  }

  // Get storage usage info
  async getStorageInfo() {
    await this.init();
    
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          available: estimate.quota || 0,
          percentage: estimate.quota ? (estimate.usage / estimate.quota) * 100 : 0
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting storage info:', error);
      return null;
    }
  }

  // Clear undo/redo history
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    // console.log('Undo/redo history cleared');
  }

  // Check if undo is available
  canUndo() {
    return this.undoStack.length > 1;
  }

  // Check if redo is available
  canRedo() {
    return this.redoStack.length > 0;
  }
}

export default ProjectManager; 